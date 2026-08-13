import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

Deno.serve(withAuth(async (_req, ctx) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Connect to ERP
    const erpUrl = Deno.env.get("ERP_BASE_URL")!;
    const erpServiceKey = Deno.env.get("ERP_SERVICE_ROLE_KEY")!;

    if (!erpUrl || !erpServiceKey) {
      return new Response(JSON.stringify({ error: "ERP credentials not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const erp = createClient(erpUrl, erpServiceKey);

    // Read units from ERP (select all columns, use only what exists)
    const { data: erpUnits, error: unitsError } = await erp
      .from("units")
      .select("*");

    if (unitsError) {
      console.error("Error reading ERP units:", unitsError);
      return new Response(JSON.stringify({ error: "Failed to read ERP units" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!erpUnits?.length) {
      return new Response(JSON.stringify({ created: 0, updated: 0, errors: [], message: "No units found in ERP" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const errors: string[] = [];

    // Build upsert data — map ERP units to local format
    const upsertRows = [];
    for (const gu of erpUnits) {
      if (!gu.code) {
        errors.push(`Unit ${gu.id}: missing code`);
        continue;
      }
      upsertRows.push({
        name: gu.name || gu.code,
        code: gu.code,
        city: gu.city || null,
        state: gu.state || null,
        is_active: gu.is_active ?? true,
        is_franqueadora: false,
        latitude: gu.latitude || null,
        longitude: gu.longitude || null,
        cep: gu.cep || null,
      });
    }

    // Count existing before upsert
    const allCodes = upsertRows.map((r) => r.code);
    let existingCount = 0;
    if (allCodes.length > 0) {
      const { count } = await supabase
        .from("units")
        .select("id", { count: "exact", head: true })
        .in("code", allCodes);
      existingCount = count || 0;
    }

    // Batch upsert using code as conflict key
    const { error: upsertError } = await supabase
      .from("units")
      .upsert(upsertRows, { onConflict: "code" });

    if (upsertError) {
      errors.push(`Batch upsert failed: ${upsertError.message}`);
    }

    const created = upsertRows.length - existingCount;
    const updated = existingCount;

    // Audit log
    await supabase.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "erp_units_sync_completed",
      module: "migration",
      details: { created, updated, errors_count: errors.length, total_erp: erpUnits.length },
    });

    return new Response(
      JSON.stringify({ created, updated, errors_count: errors.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sync-erp-units error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
