import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

Deno.serve(withAuth(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // --- ERP connection ---
    const erpUrl = Deno.env.get("ERP_BASE_URL")!;
    const erpServiceKey = Deno.env.get("ERP_SERVICE_ROLE_KEY")!;
    if (!erpUrl || !erpServiceKey) {
      return new Response(JSON.stringify({ error: "ERP credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const erp = createClient(erpUrl, erpServiceKey);

    // --- Parse pagination ---
    let offset = 0;
    let limit = 50;
    try {
      const body = await req.json();
      if (typeof body.offset === "number") offset = body.offset;
      if (typeof body.limit === "number") limit = Math.min(body.limit, 200);
    } catch { /* defaults */ }

    // --- Fetch page of franqueado roles from ERP (include unit_id) ---
    let { data: rolesPage, error: rolesError } = await erp
      .from("user_roles")
      .select("user_id, unit_id")
      .eq("role", "franqueado")
      .range(offset, offset + limit - 1);

    // Fallback: ERP may not have unit_id column anymore
    if (rolesError && (rolesError.code === "42703" || /unit_id/.test(rolesError.message || ""))) {
      console.warn("ERP user_roles has no unit_id, retrying without it");
      const retry = await erp
        .from("user_roles")
        .select("user_id")
        .eq("role", "franqueado")
        .range(offset, offset + limit - 1);
      rolesPage = retry.data as any;
      rolesError = retry.error;
    }

    if (rolesError) {
      console.error("Failed to read ERP franqueados:", rolesError.message);
      return new Response(JSON.stringify({ error: "Failed to read ERP franqueados" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rolesPage?.length) {
      return new Response(JSON.stringify({ franqueados: [], hasMore: false, nextOffset: offset }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pageUserIds = rolesPage.map((r: any) => r.user_id);

    // Build ERP user→unit mapping. ERP no longer exposes unit_id in
    // user_roles in some environments, so fall back to user_unit_links.
    const gnUserUnitMap: Record<string, string> = {};
    for (const r of rolesPage) {
      if (r.unit_id) gnUserUnitMap[r.user_id] = r.unit_id;
    }

    const usersMissingUnit = pageUserIds.filter((id: string) => !gnUserUnitMap[id]);
    if (usersMissingUnit.length) {
      try {
        let { data: unitLinks, error: unitLinksError } = await erp
          .from("user_unit_links")
          .select("user_id, unit_id, is_active")
          .in("user_id", usersMissingUnit);

        if (unitLinksError && (unitLinksError.code === "42703" || /is_active/.test(unitLinksError.message || ""))) {
          const retry = await erp
            .from("user_unit_links")
            .select("user_id, unit_id")
            .in("user_id", usersMissingUnit);
          unitLinks = retry.data as any;
          unitLinksError = retry.error;
        }

        if (unitLinksError) {
          console.warn("ERP user_unit_links fallback failed:", unitLinksError.message);
        } else {
          for (const link of unitLinks || []) {
            if (link.user_id && link.unit_id && link.is_active !== false && !gnUserUnitMap[link.user_id]) {
              gnUserUnitMap[link.user_id] = link.unit_id;
            }
          }
        }
      } catch (e) {
        console.warn("ERP user_unit_links fallback error:", e);
      }
    }

    // Resolve ERP unit names
    const gnUnitIds = [...new Set(Object.values(gnUserUnitMap))];
    let gnUnitNameMap: Record<string, string> = {};
    if (gnUnitIds.length) {
      const { data: gnUnits } = await erp.from("units").select("id, name, code").in("id", gnUnitIds);
      for (const u of gnUnits || []) {
        gnUnitNameMap[u.id] = u.name || u.code || "";
      }
    }

    // --- Fetch profiles for this page from ERP ---
    const { data: erpProfiles, error: profilesError } = await erp
      .from("profiles")
      .select("id, full_name, email, cpf, phone")
      .in("id", pageUserIds);

    if (profilesError) {
      console.error("Failed to read ERP profiles:", profilesError.message);
      return new Response(JSON.stringify({ error: "Failed to read ERP profiles" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Batch check import status ---
    const profiles = erpProfiles || [];
    const cpfs = profiles.map((p: any) => p.cpf).filter(Boolean);
    const emails = profiles.map((p: any) => p.email).filter(Boolean);

    // Fetch all local profiles matching any CPF or email in one go
    let localByCpf: Record<string, string> = {};
    let localByEmail: Record<string, string> = {};

    if (cpfs.length > 0) {
      const { data } = await supabase.from("profiles").select("id, cpf").in("cpf", cpfs);
      for (const row of (data || [])) {
        if (row.cpf) localByCpf[row.cpf] = row.id;
      }
    }
    if (emails.length > 0) {
      const { data } = await supabase.from("profiles").select("id, email").in("email", emails);
      for (const row of (data || [])) {
        if (row.email) localByEmail[row.email] = row.id;
      }
    }

    // Collect all local user IDs to check roles in batch
    const localIdSet = new Set<string>();
    const erpToLocalId: Record<string, string> = {};
    for (const p of profiles) {
      const localId = (p.cpf && localByCpf[p.cpf]) || (p.email && localByEmail[p.email]) || null;
      if (localId) {
        localIdSet.add(localId);
        erpToLocalId[p.id] = localId;
      }
    }

    // Batch check franqueado roles
    const importedLocalIds = new Set<string>();
    if (localIdSet.size > 0) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("user_id", Array.from(localIdSet))
        .eq("role", "franqueado");
      for (const r of (roles || [])) {
        importedLocalIds.add(r.user_id);
      }
    }

    const franqueados = profiles.map((p: any) => ({
      id: p.id,
      full_name: p.full_name || "",
      email: p.email || "",
      cpf: p.cpf || "",
      phone: p.phone || "",
      imported: !!(erpToLocalId[p.id] && importedLocalIds.has(erpToLocalId[p.id])),
      erp_unit_name: gnUserUnitMap[p.id] ? (gnUnitNameMap[gnUserUnitMap[p.id]] || "—") : "",
    }));

    const hasMore = rolesPage.length === limit;
    const nextOffset = offset + limit;

    return new Response(
      JSON.stringify({ franqueados, hasMore, nextOffset }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("list-erp-franqueados error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
