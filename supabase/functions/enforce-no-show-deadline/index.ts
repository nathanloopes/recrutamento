// Enforces standby resolution for no-show interviews whose 24h response window expired
// without the candidate rescheduling. Idempotent — safe to run every 15 minutes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = new Date().toISOString();

  // Pick expired no-show interviews still without resolution
  const { data: pending, error: fetchErr } = await supabase
    .from("interviews")
    .select("id, application_id, candidate_id, unit_id, scheduled_date, scheduled_time, no_show_response_deadline")
    .eq("status", "no_show")
    .is("no_show_resolution", null)
    .lte("no_show_response_deadline", new Date().toISOString())
    .limit(200);

  if (fetchErr) {
    console.error("[enforce-no-show-deadline] fetch error", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const iv of pending || []) {
    try {
      // 1) Mark interview resolution
      const { error: updIvErr } = await supabase
        .from("interviews")
        .update({ no_show_resolution: "moved_to_standby" })
        .eq("id", iv.id)
        .is("no_show_resolution", null);
      if (updIvErr) throw updIvErr;

      // 2) Move application to standby (only if still active)
      if (iv.application_id) {
        const { data: app } = await supabase
          .from("applications")
          .select("status")
          .eq("id", iv.application_id)
          .maybeSingle();
        const currentStatus = app?.status as string | undefined;
        if (currentStatus && !["contratado", "desistente", "desligado", "standby"].includes(currentStatus)) {
          await supabase
            .from("applications")
            .update({ status: "standby" })
            .eq("id", iv.application_id);
        }
      }

      // 3) Put talent pool entry on hold
      if (iv.candidate_id) {
        await supabase
          .from("talent_pool_entries")
          .update({
            status: "on_hold",
            standby_reason: "Não compareceu à entrevista e não remarcou dentro de 24h.",
            last_interaction: new Date().toISOString(),
          })
          .eq("candidate_id", iv.candidate_id)
          .in("status", ["active", "in_process"]);
      }

      // 4) Journey log
      try {
        await supabase.rpc("log_application_journey", {
          p_application_id: iv.application_id,
          p_event_type: "no_show_window_expired_moved_to_standby",
          p_skipped: false,
          p_skip_reason: null,
          p_phase_id: null,
          p_actor_role: "system",
          p_source: "system",
          p_details: { interview_id: iv.id, deadline: iv.no_show_response_deadline },
        });
      } catch (e) {
        console.warn("[enforce-no-show-deadline] journey log failed", iv.id, e);
      }

      results.push({ interview_id: iv.id, status: "moved_to_standby" });
    } catch (e) {
      console.error("[enforce-no-show-deadline] failed", iv.id, e);
      results.push({ interview_id: iv.id, status: "error", error: String(e) });
    }
  }

  console.log(`[enforce-no-show-deadline] processed=${results.length} startedAt=${startedAt}`);

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
