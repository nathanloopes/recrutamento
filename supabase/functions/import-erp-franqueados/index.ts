import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

async function resolveERPUnit(
  erp: any,
  erpUserId: string,
): Promise<{ id: string | null; code: string | null; name: string | null }> {
  let gnUnitId: string | null = null;

  try {
    const { data: gnRole } = await erp
      .from("user_roles")
      .select("unit_id")
      .eq("user_id", erpUserId)
      .eq("role", "franqueado")
      .not("unit_id", "is", null)
      .maybeSingle();
    gnUnitId = gnRole?.unit_id ?? null;
  } catch { /* ERP may not expose unit_id in user_roles */ }

  if (!gnUnitId) {
    try {
      let { data: links, error: linkError } = await erp
        .from("user_unit_links")
        .select("unit_id, is_active")
        .eq("user_id", erpUserId)
        .limit(10);

      if (linkError && (linkError.code === "42703" || /is_active/.test(linkError.message || ""))) {
        const retry = await erp
          .from("user_unit_links")
          .select("unit_id")
          .eq("user_id", erpUserId)
          .limit(10);
        links = retry.data as any;
        linkError = retry.error;
      }

      if (!linkError) {
        const link = (links || []).find((item: any) => item.unit_id && item.is_active !== false);
        gnUnitId = link?.unit_id ?? null;
      }
    } catch { /* ERP may not have user_unit_links */ }
  }

  if (!gnUnitId) return { id: null, code: null, name: null };

  const { data: gnUnit } = await erp
    .from("units")
    .select("code, name")
    .eq("id", gnUnitId)
    .maybeSingle();

  return { id: gnUnitId, code: gnUnit?.code ?? null, name: gnUnit?.name ?? null };
}

/** Resolve ERP unit_id → local unit_id via unit code/name */
async function resolveLocalUnitId(
  erp: any,
  supabase: any,
  erpUserId: string,
  fallbackUnitName?: string | null,
): Promise<string | null> {
  // Try ERP routes: user_roles.unit_id or user_unit_links.unit_id → units code/name → local unit
  const { code: gnCode, name: gnName } = await resolveERPUnit(erp, erpUserId);

  // 1. By code (exact)
  if (gnCode) {
    const { data } = await supabase.from("units").select("id").eq("code", gnCode).maybeSingle();
    if (data?.id) return data.id;
  }

  // 2. By name from ERP (case-insensitive)
  if (gnName) {
    const { data } = await supabase.from("units").select("id").ilike("name", gnName).limit(1).maybeSingle();
    if (data?.id) return data.id;
  }

  // 3. Fallback: name passed from the client payload
  if (fallbackUnitName) {
    const { data } = await supabase.from("units").select("id").ilike("name", fallbackUnitName).limit(1).maybeSingle();
    if (data?.id) return data.id;
  }

  console.warn(`[resolveLocalUnitId] could not resolve unit for ERP user ${erpUserId} (code=${gnCode}, name=${gnName}, fallback=${fallbackUnitName})`);
  return null;
}

Deno.serve(withAuth(async (req, ctx) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const erpUrl = Deno.env.get("ERP_BASE_URL");
    const erpKey = Deno.env.get("ERP_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);
    const erp = (erpUrl && erpKey) ? createClient(erpUrl, erpKey) : null;

    // --- Parse selected users ---
    const body = await req.json();
    const users = body?.users as Array<{ id: string; cpf?: string; email?: string; nome?: string; phone?: string; erp_unit_name?: string | null }>;
    if (!users?.length) {
      return new Response(JSON.stringify({ error: "Nenhum usuário selecionado." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Process only the selected users ---
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const u of users) {
      try {
        if (!u.email && !u.cpf) {
          errors.push(`${u.id}: sem email ou CPF`);
          continue;
        }

        // Resolve unit_id from ERP if available
        let localUnitId: string | null = null;
        if (erp) {
          try {
            localUnitId = await resolveLocalUnitId(erp, supabase, u.id, u.erp_unit_name ?? null);
          } catch (e) {
            console.warn(`Failed to resolve unit for ${u.id}:`, e);
          }
        }

        const rolePayload: Record<string, unknown> = {
          role: "franqueado",
          scope_access: localUnitId ? "unit" : "global",
        };
        if (localUnitId) rolePayload.unit_id = localUnitId;

        // Check if user exists locally by CPF or email
        let existingId: string | null = null;

        if (u.cpf) {
          const { data } = await supabase.from("profiles").select("id").eq("cpf", u.cpf).maybeSingle();
          if (data) existingId = data.id;
        }
        if (!existingId && u.email) {
          const { data } = await supabase.from("profiles").select("id").eq("email", u.email).maybeSingle();
          if (data) existingId = data.id;
        }

        if (existingId) {
          const { data: hasRole } = await supabase
            .from("user_roles").select("id, unit_id").eq("user_id", existingId).eq("role", "franqueado").maybeSingle();

          if (hasRole) {
            // Update unit_id if it changed
            if (localUnitId && hasRole.unit_id !== localUnitId) {
              await supabase.from("user_roles").update({ unit_id: localUnitId, scope_access: "unit" }).eq("id", hasRole.id);
              imported++;
            } else {
              skipped++;
            }
          } else {
            await supabase.from("user_roles").insert({ user_id: existingId, ...rolePayload });
            await supabase.from("activity_logs").insert({
              user_id: ctx.userId, action: "erp_franqueado_role_added", module: "migration",
              details: { target_user_id: existingId, cpf: u.cpf, unit_id: localUnitId, source: "import-erp-franqueados" },
            });
            imported++;
          }
        } else {
          // Create new user
          const tempPassword = `GF_${(u.cpf || "").replace(/\D/g, "").slice(-6)}_${Date.now().toString(36)}`;
          const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email: u.email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: u.nome, cpf: u.cpf, phone: u.phone, origin: "erp_franqueado_import" },
          });

          if (createError) {
            errors.push(`${u.email || u.cpf}: ${createError.message}`);
            continue;
          }

          const newUserId = newUser.user.id;
          await supabase.from("profiles").update({ full_name: u.nome || "", cpf: u.cpf, phone: u.phone }).eq("id", newUserId);
          await supabase.from("user_roles").insert({ user_id: newUserId, ...rolePayload });
          await supabase.from("activity_logs").insert({
            user_id: ctx.userId, action: "erp_franqueado_imported", module: "migration",
            details: { new_user_id: newUserId, email: u.email, cpf: u.cpf, unit_id: localUnitId, source: "import-erp-franqueados" },
          });
          imported++;
        }
      } catch (err) {
        errors.push(`${u.email || u.cpf}: ${(err as Error).message}`);
      }
    }

    return new Response(
      JSON.stringify({ imported, skipped, errors: errors.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("import-erp-franqueados error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
