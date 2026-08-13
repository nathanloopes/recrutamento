import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

/**
 * Synchronises franchisee ↔ unit links from ERP into the local project.
 *
 * Flow per franchisee role in ERP:
 *   1. Read user_roles where role = 'franqueado'
 *   2. Resolve ERP unit_id from user_roles or user_unit_links → unit code/name → local unit id
 *   3. Resolve ERP user (CPF/email) → local user id
 *   4. Upsert local user_roles with the resolved unit_id
 */
Deno.serve(withAuth(async (_req, ctx) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const erpUrl  = Deno.env.get("ERP_BASE_URL")!;
    const erpKey  = Deno.env.get("ERP_SERVICE_ROLE_KEY")!;

    if (!erpUrl || !erpKey) {
      return new Response(JSON.stringify({ error: "ERP credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const erp  = createClient(erpUrl, erpKey);

    // 1. Fetch ALL franqueado roles from ERP (with unit_id when available)
    let { data: gnRoles, error: gnErr } = await erp
      .from("user_roles")
      .select("user_id, unit_id")
      .eq("role", "franqueado");

    if (gnErr) {
      if (gnErr.code === "42703" || /unit_id/.test(gnErr.message || "")) {
        console.warn("ERP user_roles has no unit_id; retrying roles without it");
        const retry = await erp
          .from("user_roles")
          .select("user_id")
          .eq("role", "franqueado");
        gnRoles = retry.data as any;
        gnErr = retry.error;
      }
    }

    if (gnErr) {
      console.error("ERP user_roles read error:", gnErr.message);
      return new Response(JSON.stringify({ error: "Falha ao ler roles do ERP." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rolesWithUnit = [...(gnRoles || [])];
    const usersMissingUnit = rolesWithUnit.filter((r: any) => !r.unit_id).map((r: any) => r.user_id);

    if (usersMissingUnit.length) {
      let { data: unitLinks, error: linkErr } = await erp
        .from("user_unit_links")
        .select("user_id, unit_id, is_active")
        .in("user_id", usersMissingUnit);

      if (linkErr && (linkErr.code === "42703" || /is_active/.test(linkErr.message || ""))) {
        const retry = await erp
          .from("user_unit_links")
          .select("user_id, unit_id")
          .in("user_id", usersMissingUnit);
        unitLinks = retry.data as any;
        linkErr = retry.error;
      }

      if (linkErr) {
        console.warn("ERP user_unit_links fallback failed:", linkErr.message);
      } else {
        const userToUnit: Record<string, string> = {};
        for (const link of unitLinks || []) {
          if (link.user_id && link.unit_id && link.is_active !== false && !userToUnit[link.user_id]) {
            userToUnit[link.user_id] = link.unit_id;
          }
        }
        for (const role of rolesWithUnit) {
          if (!role.unit_id && userToUnit[role.user_id]) role.unit_id = userToUnit[role.user_id];
        }
      }
    }

    const rolesResolvedWithUnit = rolesWithUnit.filter((r: any) => r.unit_id);
    if (!rolesResolvedWithUnit.length) {
      return new Response(JSON.stringify({ linked: 0, skipped: 0, errors: 0, message: "Nenhum franqueado com unidade vinculada no ERP." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Resolve ERP unit_ids → codes/names
    const gnUnitIds = [...new Set(rolesResolvedWithUnit.map((r: any) => r.unit_id))];
    const { data: gnUnits } = await erp
      .from("units")
      .select("id, code, name")
      .in("id", gnUnitIds);

    const gnUnitCodeMap: Record<string, string> = {};
    const gnUnitNameMap: Record<string, string> = {};
    for (const u of gnUnits || []) {
      if (u.code) gnUnitCodeMap[u.id] = u.code;
      if (u.name) gnUnitNameMap[u.id] = u.name;
    }

    // 3. Resolve local unit ids by code and, when needed, by name
    const codes = [...new Set(Object.values(gnUnitCodeMap))];
    const { data: localUnits } = codes.length
      ? await supabase.from("units").select("id, code").in("code", codes)
      : { data: [] };

    const codeToLocalId: Record<string, string> = {};
    for (const u of localUnits || []) {
      if (u.code) codeToLocalId[u.code] = u.id;
    }

    // 4. Fetch ERP profiles for all franqueado users
    const gnUserIds = [...new Set(rolesWithUnit.map((r: any) => r.user_id))];
    const { data: gnProfiles } = await erp
      .from("profiles")
      .select("id, cpf, email")
      .in("id", gnUserIds);

    const gnProfileMap: Record<string, { cpf: string; email: string }> = {};
    for (const p of gnProfiles || []) {
      gnProfileMap[p.id] = { cpf: (p.cpf || "").replace(/\D/g, ""), email: (p.email || "").trim().toLowerCase() };
    }

    // 5. Batch-resolve local user ids
    const cpfs   = Object.values(gnProfileMap).map(p => p.cpf).filter(Boolean);
    const emails = Object.values(gnProfileMap).map(p => p.email).filter(Boolean);

    const localByCpf: Record<string, string> = {};
    const localByEmail: Record<string, string> = {};

    if (cpfs.length) {
      const { data } = await supabase.from("profiles").select("id, cpf").in("cpf", cpfs);
      for (const r of data || []) if (r.cpf) localByCpf[r.cpf] = r.id;
    }
    if (emails.length) {
      const { data } = await supabase.from("profiles").select("id, email").in("email", emails);
      for (const r of data || []) if (r.email) localByEmail[r.email] = r.id;
    }

    // 6. Process each role
    let linked = 0, skipped = 0, errors = 0;

    for (const role of rolesWithUnit) {
      try {
        const gnProfile = gnProfileMap[role.user_id];
        if (!gnProfile) { skipped++; continue; }

        const localUserId = (gnProfile.cpf && localByCpf[gnProfile.cpf]) || (gnProfile.email && localByEmail[gnProfile.email]) || null;
        if (!localUserId) { skipped++; continue; }

        const unitCode = gnUnitCodeMap[role.unit_id];
        const unitName = gnUnitNameMap[role.unit_id];

        let localUnitId = unitCode ? codeToLocalId[unitCode] : null;
        if (!localUnitId && unitName) {
          const { data: byName } = await supabase
            .from("units")
            .select("id")
            .ilike("name", unitName)
            .limit(1)
            .maybeSingle();
          localUnitId = byName?.id ?? null;
        }
        if (!localUnitId) { skipped++; continue; }

        // Check if role already exists with this unit
        const { data: existing } = await supabase
          .from("user_roles")
          .select("id, unit_id")
          .eq("user_id", localUserId)
          .eq("role", "franqueado")
          .maybeSingle();

        if (existing) {
          if (existing.unit_id === localUnitId) {
            skipped++;
            continue;
          }
          // Update existing role to include unit_id
          await supabase
            .from("user_roles")
            .update({ unit_id: localUnitId, scope_access: "unit" })
            .eq("id", existing.id);
        } else {
          // Insert new role with unit
          await supabase
            .from("user_roles")
            .insert({ user_id: localUserId, role: "franqueado", unit_id: localUnitId, scope_access: "unit" });
        }

        linked++;
      } catch (err) {
        console.error("Error linking franchisee:", err);
        errors++;
      }
    }

    // Audit log
    await supabase.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "sync_franchisee_units",
      module: "migration",
      details: { linked, skipped, errors, source: "sync-erp-franchisee-units" },
    });

    return new Response(
      JSON.stringify({ linked, skipped, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("sync-erp-franchisee-units error:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno ao sincronizar vínculos." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
