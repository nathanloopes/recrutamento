import { corsHeaders } from "../_shared/cors.ts";
import { withAuth, AuthenticatedRequestContext } from "../_shared/with-auth.ts";

interface ImportUser {
  nome: string;
  email: string;
  cpf: string;
  role: string;
  unit_id: string | null;
}

interface ImportResult {
  email: string;
  status: "created" | "role_assigned" | "error";
  message: string;
  temp_password?: string;
}

function generateTempPassword(cpf: string): string {
  const ts = Date.now().toString(36);
  if (cpf && cpf.length >= 6) {
    return `CP_${cpf.slice(-6)}_${ts}`;
  }
  const rand = Math.random().toString(36).slice(2, 8);
  return `CP_${rand}_${ts}`;
}

const VALID_ROLES = ["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin", "candidato"];
const UNIT_REQUIRED_ROLES = ["franqueado", "gestor_recrutamento"];

const handler = async (req: Request, ctx: AuthenticatedRequestContext): Promise<Response> => {
  const { users } = await req.json() as { users: ImportUser[] };

  if (!Array.isArray(users) || users.length === 0) {
    return new Response(JSON.stringify({ error: "No users provided" }), { status: 400, headers: corsHeaders });
  }

  if (users.length > 100) {
    return new Response(JSON.stringify({ error: "Max 100 users per batch" }), { status: 400, headers: corsHeaders });
  }

  const admin = ctx.admin;
  const results: ImportResult[] = [];
  console.log(`[import-csv-users] Processing ${users.length} users`);

  for (const u of users) {
    const email = (u.email || "").toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.push({ email, status: "error", message: "Email inválido" });
      continue;
    }

    if (!u.role || !VALID_ROLES.includes(u.role)) {
      results.push({ email, status: "error", message: `Role "${u.role}" inválida` });
      continue;
    }

    if (UNIT_REQUIRED_ROLES.includes(u.role) && !u.unit_id) {
      results.push({ email, status: "error", message: `Unidade obrigatória para role "${u.role}"` });
      continue;
    }

    try {
      console.log("[import-csv-users] row:start", JSON.stringify({ email, role: u.role, unit_id: u.unit_id, nome: u.nome || null }));

      // Check if user already exists by email in profiles view
      const { data: existingProfile } = await admin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      let userId: string;
      let tempPassword: string | undefined;
      let isNewUser = false;

      if (existingProfile) {
        userId = existingProfile.id;
        console.log("[import-csv-users] row:user-exists", JSON.stringify({ email, userId }));

        // Update profile data if provided
        const updateData: Record<string, unknown> = {};
        if (u.nome) updateData.full_name = u.nome;
        if (u.cpf) updateData.cpf = u.cpf.replace(/\D/g, "");

        if (Object.keys(updateData).length > 0) {
          await admin.from("candidates").update(updateData).eq("id", userId);
          console.log("[import-csv-users] row:profile-updated", JSON.stringify({ email, userId }));
        }
      } else {
        // NEW USER
        isNewUser = true;
        tempPassword = generateTempPassword(u.cpf || "");
        const cleanCpf = (u.cpf || "").replace(/\D/g, "");

        console.log("[import-csv-users] row:creating-user", JSON.stringify({ email, tempPassword }));

        const { data: newUser, error: createError } = await admin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            full_name: u.nome || "",
            cpf: cleanCpf || undefined,
            origin: "csv_import",
          },
        });

        if (createError || !newUser.user) {
          const errMsg = createError?.message || "Erro ao criar usuário";
          console.error("[import-csv-users] row:create-user:error", JSON.stringify({ email, message: errMsg }));
          results.push({ email, status: "error", message: errMsg });
          continue;
        }

        userId = newUser.user.id;
        console.log("[import-csv-users] row:create-user:success", JSON.stringify({ email, userId, tempPassword }));

        // Wait for handle_new_user trigger to provision candidate record
        await new Promise((r) => setTimeout(r, 800));

        // Always update candidates with full data (trigger only sets cpf)
        const { data: candidateExists } = await admin
          .from("candidates")
          .select("id")
          .eq("id", userId)
          .maybeSingle();

        if (candidateExists) {
          // Trigger created the record but without full_name/email — update it
          await admin.from("candidates").update({
            full_name: u.nome || "",
            email: email,
            cpf: cleanCpf || null,
          }).eq("id", userId);
          console.log("[import-csv-users] row:candidates-updated", JSON.stringify({ email, userId }));
        } else {
          // Rare: trigger didn't fire — insert full record
          console.log("[import-csv-users] row:trigger-fallback", JSON.stringify({ email, userId }));
          await admin.from("candidates").insert({
            id: userId,
            cpf: cleanCpf || null,
            full_name: u.nome || "",
            email: email,
            status: "registered",
          });
          await admin.from("candidate_profiles").insert({
            candidate_id: userId,
            full_name: u.nome || "",
            email: email,
          });
        }
      }

      // ROLE ASSIGNMENT: safe check-then-insert
      if (u.role !== "candidato") {
        const needsUnit = UNIT_REQUIRED_ROLES.includes(u.role);
        const scopeAccess = needsUnit ? "unidade" : "global";
        const unitId = needsUnit && u.unit_id ? u.unit_id : null;

        // Check if role already exists
        const roleQuery = admin
          .from("user_roles")
          .select("id")
          .eq("user_id", userId)
          .eq("role", u.role);

        if (unitId) {
          roleQuery.eq("unit_id", unitId);
        } else {
          roleQuery.is("unit_id", null);
        }

        const { data: existingRole } = await roleQuery.maybeSingle();

        if (existingRole) {
          console.log("[import-csv-users] row:role-already-exists", JSON.stringify({ email, role: u.role }));
        } else {
          const roleInsert: Record<string, unknown> = {
            user_id: userId,
            role: u.role,
            scope_access: scopeAccess,
          };
          if (unitId) {
            roleInsert.unit_id = unitId;
          }

          const { error: roleError } = await admin.from("user_roles").insert(roleInsert);

          if (roleError) {
            console.error("[import-csv-users] row:role-insert:error", JSON.stringify({ email, role: u.role, error: roleError.message }));
            results.push({
              email,
              status: "error",
              message: `Usuário ${isNewUser ? "criado" : "existente"}, mas falhou ao atribuir role "${u.role}": ${roleError.message}`,
              temp_password: tempPassword,
            });
            continue;
          }

          console.log("[import-csv-users] row:role-inserted", JSON.stringify({ email, role: u.role, unitId }));
        }
      }

      // Activity log
      await admin.from("activity_logs").insert({
        user_id: ctx.userId !== "service" ? ctx.userId : null,
        action: isNewUser ? "csv_user_created" : "csv_role_assigned",
        module: "usuarios",
        details: { email, role: u.role, unit_id: u.unit_id, nome: u.nome },
      });

      const finalResult: ImportResult = {
        email,
        status: isNewUser ? "created" : "role_assigned",
        message: isNewUser ? "Usuário criado" : "Role atribuída",
        temp_password: tempPassword,
      };

      console.log("[import-csv-users] row:done", JSON.stringify(finalResult));
      results.push(finalResult);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      console.error(`[import-csv-users] Error for ${u.email}:`, msg);
      results.push({ email: u.email, status: "error", message: msg });
    }
  }

  return new Response(JSON.stringify({ results }), { status: 200, headers: corsHeaders });
};

Deno.serve(withAuth(handler, { allowedRoles: ["admin", "rh_franqueadora"] }));
