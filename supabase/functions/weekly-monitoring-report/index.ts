import { corsHeaders, createAdminClient } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();

    // Load config
    const { data: configData } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "unit_monitoring");

    const config: Record<string, any> = {};
    (configData || []).forEach((r: any) => { config[r.key] = r.value; });

    const stalledDays = Number(config.stalled_days_threshold ?? 14);
    const rejectionThreshold = Number(config.rejection_rate_threshold ?? 50);
    const stalledDate = new Date();
    stalledDate.setDate(stalledDate.getDate() - stalledDays);

    // Fetch units (non-franqueadora)
    const { data: units } = await supabase
      .from("units")
      .select("id, name, city, state")
      .eq("is_active", true)
      .eq("is_franqueadora", false);

    if (!units?.length) {
      return new Response(JSON.stringify({ success: true, message: "No units" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const unitIds = units.map((u: any) => u.id);

    // Fetch unit_jobs
    const { data: unitJobs } = await supabase
      .from("unit_jobs")
      .select("id, unit_id, status, created_at")
      .in("unit_id", unitIds);

    const allJobIds = (unitJobs || []).map((j: any) => j.id);

    // Fetch applications
    let apps: any[] = [];
    const batchSize = 500;
    for (let i = 0; i < allJobIds.length; i += batchSize) {
      const batch = allJobIds.slice(i, i + batchSize);
      const { data } = await supabase
        .from("applications")
        .select("id, unit_job_id, status, created_at")
        .in("unit_job_id", batch);
      if (data) apps = apps.concat(data);
    }

    // Build per-unit metrics
    const jobsByUnit: Record<string, any[]> = {};
    (unitJobs || []).forEach((j: any) => {
      if (!jobsByUnit[j.unit_id]) jobsByUnit[j.unit_id] = [];
      jobsByUnit[j.unit_id].push(j);
    });

    const appsByJob: Record<string, any[]> = {};
    apps.forEach((a: any) => {
      if (!appsByJob[a.unit_job_id]) appsByJob[a.unit_job_id] = [];
      appsByJob[a.unit_job_id].push(a);
    });

    // Get admin users for notifications
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "rh_franqueadora"]);

    const adminIds = [...new Set((admins || []).map((a: any) => a.user_id))];

    // Summary metrics
    const summary = {
      totalUnits: units.length,
      totalOpenJobs: 0,
      totalCandidates: 0,
      totalHired: 0,
      totalRejected: 0,
      totalWithdrawn: 0,
      unitsWithAlerts: 0,
      alerts: [] as { unitName: string; alert: string }[],
    };

    units.forEach((u: any) => {
      const jobs = jobsByUnit[u.id] || [];
      const openJobs = jobs.filter((j: any) => j.status === "aberta");
      summary.totalOpenJobs += openJobs.length;

      const unitApps: any[] = [];
      jobs.forEach((j: any) => (appsByJob[j.id] || []).forEach((a: any) => unitApps.push(a)));

      const total = unitApps.length;
      summary.totalCandidates += total;

      const hired = unitApps.filter((a: any) => a.status === "contratado").length;
      const rejected = unitApps.filter((a: any) => a.status === "reprovado").length;
      const withdrawn = unitApps.filter((a: any) => a.status === "desistente").length;
      summary.totalHired += hired;
      summary.totalRejected += rejected;
      summary.totalWithdrawn += withdrawn;

      const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0;
      const withdrawalRate = total > 0 ? Math.round((withdrawn / total) * 100) : 0;

      const unitAlerts: string[] = [];

      // Stalled jobs
      let stalledJobs = 0;
      openJobs.forEach((j: any) => {
        const jobApps = appsByJob[j.id] || [];
        const latestApp = jobApps.length > 0
          ? jobApps.reduce((latest: any, a: any) => new Date(a.created_at) > new Date(latest.created_at) ? a : latest)
          : null;
        const refDate = latestApp ? new Date(latestApp.created_at) : new Date(j.created_at);
        if (refDate < stalledDate) stalledJobs++;
      });

      if (stalledJobs > 0) unitAlerts.push("Vaga Parada");
      if (rejectionRate > rejectionThreshold) unitAlerts.push("Alta Reprovação");
      if (withdrawalRate > 30) unitAlerts.push("Alta Desistência");
      
      const isLowConversion = total > 5 && hired === 0;

      if (unitAlerts.length > 0 || isLowConversion) {
        if (isLowConversion) unitAlerts.push("Conversão Baixa");
        summary.unitsWithAlerts++;
        unitAlerts.forEach((a) => summary.alerts.push({ unitName: u.name, alert: a }));
      }
    });

    // Build weekly report body
    const conversionRate = summary.totalCandidates > 0
      ? Math.round((summary.totalHired / summary.totalCandidates) * 100)
      : 0;

    const reportBody = [
      `📊 Relatório Semanal de Monitoramento`,
      ``,
      `Unidades ativas: ${summary.totalUnits}`,
      `Vagas abertas: ${summary.totalOpenJobs}`,
      `Candidatos: ${summary.totalCandidates}`,
      `Contratados: ${summary.totalHired} (${conversionRate}%)`,
      `Em Standby: ${summary.totalRejected}`,
      `Desistentes: ${summary.totalWithdrawn}`,
      ``,
      `⚠️ Unidades com alertas: ${summary.unitsWithAlerts}`,
      ...summary.alerts.slice(0, 10).map((a) => `  • ${a.unitName}: ${a.alert}`),
      summary.alerts.length > 10 ? `  ... e mais ${summary.alerts.length - 10} alertas` : "",
    ].join("\n");

    // Date bucket for dedup (YYYY-MM-DD)
    const todayBucket = new Date().toISOString().slice(0, 10);

    // Send notification to all admins with dedup_key
    if (adminIds.length > 0) {
      const notifications = adminIds.map((adminId: string) => ({
        event_type: "weekly_monitoring_report",
        recipient_id: adminId,
        channel: "push",
        title: "Relatório Semanal de Monitoramento",
        body: reportBody,
        status: "pending",
        payload: { report_date: new Date().toISOString(), summary },
        action_url: "/admin/unidades",
        action_type: "info",
        dedup_key: `weekly_monitoring_report:${adminId}:${todayBucket}`,
      }));

      // Use individual inserts to skip duplicates (unique index will reject)
      for (const notif of notifications) {
        try {
          await supabase.from("notifications").insert(notif);
        } catch (_dupErr) {
          // Duplicate — silently skip
        }
      }

      // Email for low conversion alerts
      const lowConversionAlerts = summary.alerts.filter((a: any) => a.alert === "Conversão Baixa");
      if (lowConversionAlerts.length > 0) {
        const { data: adminProfiles } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", adminIds);

        const adminsWithEmail = (adminProfiles || []).filter((p: any) => p.email);
        for (const admin of adminsWithEmail) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                to_email: admin.email,
                to_name: admin.full_name || admin.email,
                subject: `⚠️ Alerta: ${lowConversionAlerts.length} unidade(s) com conversão baixa`,
                html_content: `<h2>Alerta de Conversão Baixa</h2>
<p>As seguintes unidades apresentam conversão baixa no período:</p>
<ul>${lowConversionAlerts.map((a: any) => `<li><strong>${a.unitName}</strong>: ${a.alert}</li>`).join("")}</ul>
<p>Acesse o <a href="/admin/unidades">painel de monitoramento</a> para mais detalhes.</p>`,
                text_content: `Alerta de Conversão Baixa\n\n${lowConversionAlerts.map((a: any) => `${a.unitName}: ${a.alert}`).join("\n")}\n\nAcesse o painel de monitoramento para mais detalhes.`,
              },
            });
          } catch (emailErr) {
            console.warn("Email delivery for low conversion failed:", emailErr);
          }
        }
      }
    }

    // Audit log
    await supabase.from("activity_logs").insert({
      action: "weekly_report_generated",
      module: "monitoramento",
      details: summary,
    });

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
