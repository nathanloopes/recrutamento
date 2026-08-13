import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeadersFallback = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const headers = { ...corsHeadersFallback, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFallback });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Total admin users
    const { count: totalAdmins } = await supabase
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .in("role", ["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin"] as any);

    // 2. Permission changes in period
    const { count: permissionChanges } = await supabase
      .from("activity_logs")
      .select("id", { count: "exact", head: true })
      .eq("module", "usuarios_permissoes")
      .gte("created_at", thirtyDaysAgo);

    // 3. Failed logins in period
    const { count: failedLogins } = await supabase
      .from("access_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "failed_login")
      .gte("created_at", thirtyDaysAgo);

    // 4. Successful logins
    const { count: successfulLogins } = await supabase
      .from("access_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "login")
      .gte("created_at", thirtyDaysAgo);

    // 5. User blocks in period
    const { count: userBlocks } = await supabase
      .from("access_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "user_blocked")
      .gte("created_at", thirtyDaysAgo);

    // 6. Sensitive access events
    const { count: sensitiveAccess } = await supabase
      .from("access_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "sensitive_access")
      .gte("created_at", thirtyDaysAgo);

    // 7. Data exports
    const { count: dataExports } = await supabase
      .from("access_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "data_export")
      .gte("created_at", thirtyDaysAgo);

    // 8. Anomalies
    const { data: anomalies } = await supabase.rpc("detect_access_anomalies");

    // Generate report
    const report = {
      periodo: {
        inicio: thirtyDaysAgo,
        fim: now.toISOString(),
      },
      resumo: {
        total_administradores: totalAdmins || 0,
        alteracoes_permissao: permissionChanges || 0,
        logins_sucesso: successfulLogins || 0,
        logins_falha: failedLogins || 0,
        usuarios_bloqueados: userBlocks || 0,
        acessos_sensiveis: sensitiveAccess || 0,
        exportacoes_dados: dataExports || 0,
        anomalias_detectadas: anomalies?.length || 0,
      },
      anomalias: anomalies || [],
      recomendacoes: [] as string[],
    };

    // Generate recommendations
    if ((failedLogins || 0) > 50) {
      report.recomendacoes.push("Alto volume de falhas de login detectado. Considere revisar a política de senhas e habilitar auto_block_on_anomaly.");
    }
    if ((anomalies?.length || 0) > 0) {
      report.recomendacoes.push(`${anomalies!.length} anomalia(s) de acesso detectada(s). Verifique os IPs suspeitos na aba Alertas.`);
    }
    if ((permissionChanges || 0) > 20) {
      report.recomendacoes.push("Muitas alterações de permissão no período. Revise se todas foram autorizadas.");
    }
    if (report.recomendacoes.length === 0) {
      report.recomendacoes.push("Nenhuma anomalia significativa detectada. O sistema está operando dentro dos parâmetros normais.");
    }

    // Log execution
    await supabase.from("activity_logs").insert({
      action: "ai_governance_report_generated",
      module: "ia_governance",
      details: { report_period: "30d", ...report.resumo },
    });

    return new Response(
      JSON.stringify({ success: true, report }),
      { headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers }
    );
  }
});
