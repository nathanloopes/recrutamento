import { corsHeaders } from "../_shared/cors.ts";
import { withAuth, AuthenticatedRequestContext } from "../_shared/with-auth.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function generateTempPassword(cpf: string): string {
  const last6 = cpf.replace(/\D/g, "").slice(-6) || "000000";
  const ts = Date.now().toString(36).slice(-4);
  return `CP_${last6}_${ts}`;
}

function parseAdmissionDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.trim();
  // Try DD/MM/YYYY
  const brMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (brMatch) {
    const [, d, m, y] = brMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Try YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return cleaned.slice(0, 10);
  return null;
}

interface CollaboratorInput {
  full_name: string;
  cpf: string;
  email: string;
  cargo: string;
  area: string;
  setor: string;
  departamento: string;
  salario: string;
  admissao: string;
  empresa: string;
}

// Caches to avoid repeated queries within a batch
const jobCache = new Map<string, string>(); // cargo lowercase -> job id
const unitCache = new Map<string, { id: string; code: string }>(); // empresa lowercase -> unit
const unitJobCache = new Map<string, string>(); // `${unitId}_${jobId}` -> unit_job id

const handler = withAuth(async (req: Request, ctx: AuthenticatedRequestContext): Promise<Response> => {
  const body = await req.json();
  const collaborators: CollaboratorInput[] = body.collaborators || [];

  if (!Array.isArray(collaborators) || collaborators.length === 0) {
    return new Response(JSON.stringify({ error: "No collaborators provided" }), { status: 400, headers: corsHeaders });
  }

  if (collaborators.length > 100) {
    return new Response(JSON.stringify({ error: "Maximum 100 collaborators per batch" }), { status: 400, headers: corsHeaders });
  }

  const { admin } = ctx;

  // Pre-load franqueadora unit as default fallback
  let defaultUnit: { id: string; code: string } | null = null;
  {
    const { data } = await admin.from("units").select("id, code").eq("is_franqueadora", true).limit(1).maybeSingle();
    if (data) defaultUnit = { id: data.id, code: data.code || "" };
  }

  // --- Helper: Resolve Job by cargo ---
  async function resolveJob(cargo: string): Promise<string | null> {
    const cargoTrimmed = (cargo || "").trim();
    if (!cargoTrimmed) return null;
    const key = cargoTrimmed.toLowerCase();

    if (jobCache.has(key)) return jobCache.get(key)!;

    // Search existing
    const { data: existing } = await admin
      .from("jobs")
      .select("id")
      .ilike("title", cargoTrimmed)
      .limit(1)
      .maybeSingle();

    if (existing) {
      jobCache.set(key, existing.id);
      return existing.id;
    }

    // Create new job
    const { data: created, error } = await admin
      .from("jobs")
      .insert({
        title: cargoTrimmed,
        is_active: true,
        created_by: ctx.userId !== "service" ? ctx.userId : null,
      } as any)
      .select("id")
      .single();

    if (error || !created) return null;
    jobCache.set(key, created.id);
    return created.id;
  }

  // --- Helper: Resolve Unit by empresa ---
  async function resolveUnit(empresa: string): Promise<{ id: string; code: string }> {
    const empresaTrimmed = (empresa || "").trim();
    if (!empresaTrimmed) return defaultUnit || { id: "", code: "" };
    const key = empresaTrimmed.toLowerCase();

    if (unitCache.has(key)) return unitCache.get(key)!;

    // Search by name
    const { data: byName } = await admin
      .from("units")
      .select("id, code")
      .ilike("name", empresaTrimmed)
      .limit(1)
      .maybeSingle();

    if (byName) {
      const u = { id: byName.id, code: byName.code || "" };
      unitCache.set(key, u);
      return u;
    }

    // Search by code
    const { data: byCode } = await admin
      .from("units")
      .select("id, code")
      .ilike("code", empresaTrimmed)
      .limit(1)
      .maybeSingle();

    if (byCode) {
      const u = { id: byCode.id, code: byCode.code || "" };
      unitCache.set(key, u);
      return u;
    }

    // Fallback to franqueadora
    if (defaultUnit) {
      unitCache.set(key, defaultUnit);
      return defaultUnit;
    }
    return { id: "", code: "" };
  }

  // --- Helper: Resolve or create unit_job ---
  async function resolveUnitJob(unitId: string, jobId: string, salary?: string): Promise<string | null> {
    if (!unitId || !jobId) return null;
    const cacheKey = `${unitId}_${jobId}`;

    if (unitJobCache.has(cacheKey)) return unitJobCache.get(cacheKey)!;

    const { data: existing } = await admin
      .from("unit_jobs")
      .select("id")
      .eq("unit_id", unitId)
      .eq("job_id", jobId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      unitJobCache.set(cacheKey, existing.id);
      return existing.id;
    }

    // Create new unit_job
    const insertPayload: any = {
      unit_id: unitId,
      job_id: jobId,
      status: "aberta",
    };
    if (salary) insertPayload.salary = salary;

    const { data: created, error } = await admin
      .from("unit_jobs")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error || !created) return null;
    unitJobCache.set(cacheKey, created.id);
    return created.id;
  }

  const results: Array<{ email: string; cpf: string; status: string; message: string; temp_password?: string }> = [];

  for (const collab of collaborators) {
    try {
      const cpfClean = (collab.cpf || "").replace(/\D/g, "");
      const email = (collab.email || "").trim().toLowerCase();
      const fullName = (collab.full_name || "").trim();

      if (!fullName) {
        results.push({ email, cpf: cpfClean, status: "error", message: "Nome obrigatório" });
        continue;
      }

      if (!email && !cpfClean) {
        results.push({ email, cpf: cpfClean, status: "error", message: "Email ou CPF obrigatório" });
        continue;
      }

      // Check duplicate by email
      if (email) {
        const { data: existingByEmail } = await admin
          .from("candidates")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (existingByEmail) {
          results.push({ email, cpf: cpfClean, status: "duplicate", message: "Email já cadastrado" });
          continue;
        }
      }

      // Check duplicate by CPF
      if (cpfClean) {
        const { data: existingByCpf } = await admin
          .from("candidates")
          .select("id")
          .eq("cpf", cpfClean)
          .maybeSingle();

        if (existingByCpf) {
          results.push({ email, cpf: cpfClean, status: "duplicate", message: "CPF já cadastrado" });
          continue;
        }

        const { data: existingInternal } = await admin
          .from("internal_users")
          .select("id")
          .eq("cpf", cpfClean)
          .maybeSingle();

        if (existingInternal) {
          results.push({ email, cpf: cpfClean, status: "duplicate", message: "CPF já existe em internal_users" });
          continue;
        }
      }

      // ====== STEP 1: Resolve Job ======
      const jobId = await resolveJob(collab.cargo);

      // ====== STEP 2: Resolve Unit ======
      const unit = await resolveUnit(collab.empresa);

      // ====== STEP 3: Resolve Unit Job (Vaga) ======
      let unitJobId: string | null = null;
      if (jobId && unit.id) {
        unitJobId = await resolveUnitJob(unit.id, jobId, collab.salario);
      }

      // ====== Create Auth User ======
      const tempPassword = generateTempPassword(cpfClean || email);
      const loginEmail = email || `${cpfClean}@colaborador.local`;

      const { data: authUser, error: authError } = await admin.auth.admin.createUser({
        email: loginEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, cpf: cpfClean },
      });

      if (authError) {
        results.push({ email, cpf: cpfClean, status: "error", message: authError.message });
        continue;
      }

      const userId = authUser.user.id;

      // Wait for handle_new_user trigger
      await sleep(800);

      // Update candidates table
      const admissionDate = parseAdmissionDate(collab.admissao);
      const hasAdmission = !!admissionDate;
      const candidateStatus = hasAdmission ? "contratado" : "em_andamento";

      await admin.from("candidates").update({
        cpf: cpfClean || null,
        full_name: fullName,
        email: email || null,
        status: candidateStatus as any,
      }).eq("id", userId);

      // Update candidate_profiles
      await admin.from("candidate_profiles").upsert({
        candidate_id: userId,
        full_name: fullName,
        email: email || null,
      }, { onConflict: "candidate_id" });

      // ====== STEP 4: Application + Migration (Hiring Record) ======
      if (unitJobId) {
        const appStatus = hasAdmission ? "contratado" : "em_andamento";
        const { data: appData } = await admin.from("applications").insert({
          candidate_id: userId,
          unit_job_id: unitJobId,
          status: appStatus as any,
        }).select("id").single();

        // If admission date exists → create migration_logs (completed)
        if (hasAdmission && appData && cpfClean) {
          await admin.from("migration_logs").insert({
            candidate_id: userId,
            application_id: appData.id,
            unit_id: unit.id,
            job_id: jobId,
            target_role: collab.cargo || "colaborador",
            triggered_by: ctx.userId !== "service" ? ctx.userId : null,
            status: "completed",
            completed_at: admissionDate,
          } as any);
        }
      }

      // ====== STEP 5: Insert into internal_users with unit_code ======
      await admin.from("internal_users").insert({
        cpf: cpfClean || null,
        name: fullName,
        email: email || null,
        role: collab.cargo || "colaborador",
        status: "ativo",
        unit_code: unit.code || null,
      } as any);

      // Activity log
      await admin.from("activity_logs").insert({
        user_id: ctx.userId !== "service" ? ctx.userId : null,
        action: "csv_collaborator_created",
        module: "colaboradores",
        details: {
          created_user_id: userId,
          full_name: fullName,
          cpf: cpfClean,
          email,
          cargo: collab.cargo,
          job_id: jobId,
          unit_id: unit.id,
          unit_job_id: unitJobId,
          has_admission: hasAdmission,
        },
      });

      results.push({
        email,
        cpf: cpfClean,
        status: "success",
        message: "Colaborador criado com sucesso",
        temp_password: tempPassword,
      });
    } catch (err: any) {
      results.push({
        email: collab.email || "",
        cpf: collab.cpf || "",
        status: "error",
        message: err.message || "Erro desconhecido",
      });
    }
  }

  return new Response(JSON.stringify({ results }), { status: 200, headers: corsHeaders });
}, { allowedRoles: ["admin", "rh_franqueadora"] });

Deno.serve(handler);
