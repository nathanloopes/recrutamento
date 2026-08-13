import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Enforce snapshot_frequency from CrossConfig
    const { data: freqSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "dashboard")
      .eq("key", "snapshot_frequency")
      .maybeSingle();

    const frequency = (freqSetting?.value as string) || "daily";
    const intervalHours = frequency === "weekly" ? 168 : 24; // 7 days or 1 day

    // Check last snapshot timestamp
    const { data: lastSnapshot } = await supabase
      .from("metrics_snapshots")
      .select("created_at")
      .is("unit_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSnapshot) {
      const lastTime = new Date(lastSnapshot.created_at).getTime();
      const hoursSinceLast = (Date.now() - lastTime) / (1000 * 60 * 60);
      if (hoursSinceLast < intervalHours) {
        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            reason: `Last snapshot was ${Math.round(hoursSinceLast)}h ago. Frequency: ${frequency} (${intervalHours}h). Next in ~${Math.round(intervalHours - hoursSinceLast)}h.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch all applications
    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("id, status, created_at, updated_at, unit_job_id");

    if (appsErr) throw appsErr;

    // Fetch open jobs count
    const { count: totalJobsOpen } = await supabase
      .from("unit_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "aberta");

    // Fetch unit_jobs for grouping by unit
    const { data: ujData } = await supabase
      .from("unit_jobs")
      .select("id, unit_id");

    const ujMap = new Map((ujData || []).map((uj: any) => [uj.id, uj.unit_id]));

    // Global metrics
    const allApps = apps || [];
    const totalCandidates = allApps.filter((a: any) => a.status === "em_andamento").length;
    const hired = allApps.filter((a: any) => a.status === "contratado");
    const rejected = allApps.filter((a: any) => a.status === "reprovado").length;
    const total = allApps.length;

    const conversionRate = total > 0 ? Math.round((hired.length / total) * 10000) / 100 : 0;
    const rejectionRate = total > 0 ? Math.round((rejected / total) * 10000) / 100 : 0;

    let avgHiringTime = 0;
    if (hired.length > 0) {
      const totalDays = hired.reduce((sum: number, a: any) => {
        const days = (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0);
      avgHiringTime = Math.round((totalDays / hired.length) * 100) / 100;
    }

    // Insert global snapshot
    const { error: insertErr } = await supabase.from("metrics_snapshots").insert({
      total_candidates: totalCandidates,
      total_jobs_open: totalJobsOpen || 0,
      avg_hiring_time_days: avgHiringTime,
      conversion_rate: conversionRate,
      rejection_rate: rejectionRate,
      period: "daily",
      unit_id: null,
    });

    if (insertErr) throw insertErr;

    // Per-unit snapshots
    const unitStats = new Map<string, { active: number; total: number; hired: number; rejected: number; totalDays: number }>();

    allApps.forEach((a: any) => {
      const unitId = ujMap.get(a.unit_job_id);
      if (!unitId) return;
      if (!unitStats.has(unitId)) unitStats.set(unitId, { active: 0, total: 0, hired: 0, rejected: 0, totalDays: 0 });
      const s = unitStats.get(unitId)!;
      s.total++;
      if (a.status === "em_andamento") s.active++;
      if (a.status === "reprovado") s.rejected++;
      if (a.status === "contratado") {
        s.hired++;
        s.totalDays += (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24);
      }
    });

    // Count open jobs per unit
    const { data: openJobsPerUnit } = await supabase
      .from("unit_jobs")
      .select("unit_id")
      .eq("status", "aberta");

    const jobsPerUnit = new Map<string, number>();
    (openJobsPerUnit || []).forEach((j: any) => {
      jobsPerUnit.set(j.unit_id, (jobsPerUnit.get(j.unit_id) || 0) + 1);
    });

    const unitRows = Array.from(unitStats.entries()).map(([unitId, s]) => ({
      total_candidates: s.active,
      total_jobs_open: jobsPerUnit.get(unitId) || 0,
      avg_hiring_time_days: s.hired > 0 ? Math.round((s.totalDays / s.hired) * 100) / 100 : 0,
      conversion_rate: s.total > 0 ? Math.round((s.hired / s.total) * 10000) / 100 : 0,
      rejection_rate: s.total > 0 ? Math.round((s.rejected / s.total) * 10000) / 100 : 0,
      period: "daily",
      unit_id: unitId,
    }));

    if (unitRows.length > 0) {
      const { error: unitInsertErr } = await supabase.from("metrics_snapshots").insert(unitRows);
      if (unitInsertErr) throw unitInsertErr;
    }

    // ─── Gargalo Detection & Push Notifications (onGargaloDetectado / onTempoElevado) ───
    let gargaloNotifications = 0;
    try {
      // Load thresholds from CrossConfig
      const { data: settings } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "dashboard");

      const getVal = (key: string, fallback: number) => {
        const s = (settings || []).find((s: any) => s.key === key);
        return s ? Number(s.value) || fallback : fallback;
      };

      const maxDays = getVal("max_hiring_days_alert", 30);
      const minConversion = getVal("min_conversion_rate", 10);
      const rejThreshold = getVal("rejection_threshold", 70);

      // Get unit names
      const { data: units } = await supabase.from("units").select("id, name");
      const unitNameMap = new Map((units || []).map((u: any) => [u.id, u.name]));

      // Get admin recipients
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id, role, unit_id")
        .in("role", ["admin", "rh_franqueadora", "franqueado"]);

      const globalAdmins = (adminRoles || [])
        .filter((r: any) => r.role === "admin" || r.role === "rh_franqueadora")
        .map((r: any) => r.user_id);

      const franchiseesByUnit = new Map<string, string[]>();
      (adminRoles || []).filter((r: any) => r.role === "franqueado" && r.unit_id).forEach((r: any) => {
        if (!franchiseesByUnit.has(r.unit_id)) franchiseesByUnit.set(r.unit_id, []);
        franchiseesByUnit.get(r.unit_id)!.push(r.user_id);
      });

      const notificationsToInsert: any[] = [];

      for (const [unitId, s] of unitStats.entries()) {
        const unitName = unitNameMap.get(unitId) || "Unidade";
        const unitConvRate = s.total > 0 ? (s.hired / s.total) * 100 : 0;
        const unitRejRate = s.total > 0 ? (s.rejected / s.total) * 100 : 0;
        const unitAvgDays = s.hired > 0 ? s.totalDays / s.hired : 0;

        const recipients = new Set([...globalAdmins, ...(franchiseesByUnit.get(unitId) || [])]);

        // onGargaloDetectado: baixa conversão
        if (s.total >= 5 && unitConvRate < minConversion) {
          for (const recipientId of recipients) {
            notificationsToInsert.push({
              event_type: "gargalo_baixa_conversao",
              recipient_id: recipientId,
              channel: "push",
              title: `Baixa conversão: ${unitName}`,
              body: `A unidade ${unitName} está com ${Math.round(unitConvRate)}% de conversão (mínimo: ${minConversion}%).`,
              status: "pending",
              payload: { unit_id: unitId, conversion_rate: Math.round(unitConvRate * 100) / 100 },
              action_url: "/admin/dashboard",
              action_type: "action_required",
            });
          }
        }

        // onGargaloDetectado: alta rejeição
        if (s.total >= 5 && unitRejRate >= rejThreshold) {
          for (const recipientId of recipients) {
            notificationsToInsert.push({
              event_type: "gargalo_alta_rejeicao",
              recipient_id: recipientId,
              channel: "push",
              title: `Alta rejeição: ${unitName}`,
              body: `A unidade ${unitName} atingiu ${Math.round(unitRejRate)}% de rejeição (limite: ${rejThreshold}%).`,
              status: "pending",
              payload: { unit_id: unitId, rejection_rate: Math.round(unitRejRate * 100) / 100 },
              action_url: "/admin/dashboard",
              action_type: "action_required",
            });
          }
        }

        // onTempoElevado: tempo médio alto
        if (s.hired > 0 && unitAvgDays > maxDays) {
          for (const recipientId of recipients) {
            notificationsToInsert.push({
              event_type: "gargalo_tempo_elevado",
              recipient_id: recipientId,
              channel: "push",
              title: `Tempo elevado: ${unitName}`,
              body: `A unidade ${unitName} está com tempo médio de ${Math.round(unitAvgDays)} dias (máximo: ${maxDays}).`,
              status: "pending",
              payload: { unit_id: unitId, avg_days: Math.round(unitAvgDays) },
              action_url: "/admin/dashboard",
              action_type: "action_required",
            });
          }
        }
      }

      // Deduplicate: only send if same event_type+unit wasn't sent in last 24h
      if (notificationsToInsert.length > 0) {
        const { data: recentNotifs } = await supabase
          .from("notifications")
          .select("event_type, payload")
          .in("event_type", ["gargalo_baixa_conversao", "gargalo_alta_rejeicao", "gargalo_tempo_elevado"])
          .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        const recentKeys = new Set(
          (recentNotifs || []).map((n: any) => `${n.event_type}:${n.payload?.unit_id}`)
        );

        const filtered = notificationsToInsert.filter(
          (n) => !recentKeys.has(`${n.event_type}:${n.payload?.unit_id}`)
        );

        if (filtered.length > 0) {
          await supabase.from("notifications").insert(filtered);
          gargaloNotifications = filtered.length;
        }
      }
    } catch (gErr: any) {
      console.error("Gargalo notification error (non-fatal):", gErr.message);
    }

    return new Response(
      JSON.stringify({ success: true, global: 1, units: unitRows.length, gargalo_notifications: gargaloNotifications }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
