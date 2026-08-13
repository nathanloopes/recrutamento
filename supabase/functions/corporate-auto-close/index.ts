import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * corporate-auto-close
 * Automatically closes corporate jobs (unit_jobs from franqueadora units) that exceed
 * the configured corporate_auto_close_days from global_settings.
 * 
 * Designed to be called via pg_cron or scheduled invocation.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Read corporate_auto_close_days from CrossConfig
    const { data: closeSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "corporate_jobs")
      .eq("key", "corporate_auto_close_days")
      .maybeSingle();

    const autoCloseDays = Number(closeSetting?.value) || 0;
    if (autoCloseDays <= 0) {
      return new Response(
        JSON.stringify({ closed: 0, reason: "corporate_auto_close_days is 0 or not set" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - autoCloseDays);

    // Find open corporate jobs (from franqueadora units) older than cutoff
    const { data: expiredJobs, error: queryErr } = await supabase
      .from("unit_jobs")
      .select("id, unit_id, created_at, units!inner(is_franqueadora)")
      .eq("status", "aberta")
      .eq("units.is_franqueadora", true)
      .lt("created_at", cutoffDate.toISOString());

    if (queryErr) {
      console.error("Query error:", queryErr);
      throw queryErr;
    }

    const jobIds = (expiredJobs || []).map((j: any) => j.id);
    let closedCount = 0;

    if (jobIds.length > 0) {
      const { error: updateErr } = await supabase
        .from("unit_jobs")
        .update({ status: "fechada" } as any)
        .in("id", jobIds);

      if (updateErr) {
        console.error("Update error:", updateErr);
        throw updateErr;
      }
      closedCount = jobIds.length;

      // Log each closure
      for (const job of (expiredJobs || [])) {
        await supabase.from("activity_logs").insert({
          action: "corporate_job_auto_closed",
          module: "vagas_corporativas",
          details: {
            unit_job_id: job.id,
            unit_id: job.unit_id,
            auto_close_days: autoCloseDays,
            created_at: job.created_at,
          },
        });
      }
    }

    return new Response(
      JSON.stringify({ closed: closedCount, auto_close_days: autoCloseDays, cutoff: cutoffDate.toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("corporate-auto-close error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
