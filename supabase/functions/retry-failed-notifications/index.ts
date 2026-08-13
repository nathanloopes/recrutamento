import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * retry-failed-notifications
 * Retries failed notifications respecting CrossConfig:
 * - retry_on_failure: kill switch for retries
 * - retry_interval_minutes: minimum age before retrying
 * - max_retries: maximum retry attempts per notification
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Auth gate: service-role only (cron-driven) ──
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    let authorized = !!bearer && bearer === serviceKey;
    if (!authorized && bearer && bearer !== anonKey) {
      // Allow authenticated admin trigger as well
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
      const { data: u } = await userClient.auth.getUser();
      if (u?.user) {
        const admin = createClient(supabaseUrl, serviceKey);
        const { data: isAdmin } = await admin.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
        authorized = !!isAdmin;
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Read retry settings from CrossConfig
    const { data: notifSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "notifications");

    const getVal = (key: string, fallback: number) => {
      const s = (notifSettings || []).find((s: any) => s.key === key);
      const v = Number(s?.value);
      return !isNaN(v) && v > 0 ? v : fallback;
    };
    const getBool = (key: string, fallback: boolean) => {
      const s = (notifSettings || []).find((s: any) => s.key === key);
      if (s === undefined) return fallback;
      return s.value === true || s.value === "true";
    };

    // ── CHECK: retry_on_failure kill switch ──
    const retryEnabled = getBool("retry_on_failure", true);
    if (!retryEnabled) {
      return new Response(
        JSON.stringify({
          blocked: "retry_on_failure_disabled",
          total_found: 0,
          retried: 0,
          skipped: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const retryIntervalMinutes = getVal("retry_interval_minutes", 30);
    const maxRetries = getVal("max_retries", 3);

    // Find failed notifications older than retry_interval_minutes
    const cutoff = new Date(Date.now() - retryIntervalMinutes * 60 * 1000).toISOString();
    const orphanCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Failed notifications eligible for retry
    const { data: failedNotifs, error } = await supabase
      .from("notifications")
      .select("id, event_type, recipient_id, title, body, payload, retry_count")
      .eq("status", "failed")
      .lt("updated_at", cutoff)
      .limit(50);

    if (error) throw error;

    // Orphan pending notifications (>5min, never processed) — no delivery_logs at all
    const { data: pendingOrphans } = await supabase
      .from("notifications")
      .select("id, event_type, recipient_id, title, body, payload, retry_count")
      .eq("status", "pending")
      .lt("created_at", orphanCutoff)
      .limit(50);

    const orphansToRetry: any[] = [];
    for (const p of (pendingOrphans || [])) {
      const { count } = await supabase
        .from("delivery_logs")
        .select("id", { count: "exact", head: true })
        .eq("notification_id", p.id);
      if ((count || 0) === 0) orphansToRetry.push(p);
    }

    const allToRetry = [...(failedNotifs || []), ...orphansToRetry];

    let retried = 0;
    let skipped = 0;

    for (const notif of allToRetry) {
      const retryCount = (notif as any).retry_count || 0;

      if (retryCount >= maxRetries) {
        skipped++;
        continue;
      }

      // Retry via cascade
      try {
        const cascadeRes = await fetch(`${supabaseUrl}/functions/v1/send-notification-cascade`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ notification_id: notif.id }),
        });

        const result = await cascadeRes.json();

        // Increment retry_count
        await supabase
          .from("notifications")
          .update({
            retry_count: retryCount + 1,
            status: result.delivered ? "sent" : "failed",
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", notif.id);

        if (result.delivered) retried++;
      } catch (retryErr) {
        console.error(`Retry failed for notification ${notif.id}:`, retryErr);
        await supabase
          .from("notifications")
          .update({
            retry_count: retryCount + 1,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", notif.id);
      }
    }

    // Log
    await supabase.from("activity_logs").insert({
      action: "notification_retry_batch",
      module: "notificacoes",
      details: {
        total_found: allToRetry.length,
        failed_count: (failedNotifs || []).length,
        orphan_pending_count: orphansToRetry.length,
        retried,
        skipped,
        retry_interval_minutes: retryIntervalMinutes,
        max_retries: maxRetries,
        retry_on_failure: retryEnabled,
      },
    });

    return new Response(
      JSON.stringify({
        total_found: allToRetry.length,
        failed_count: (failedNotifs || []).length,
        orphan_pending_count: orphansToRetry.length,
        retried,
        skipped,
        retry_interval_minutes: retryIntervalMinutes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("retry-failed-notifications error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
