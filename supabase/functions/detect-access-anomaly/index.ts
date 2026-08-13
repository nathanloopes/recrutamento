import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAnomalyConfig } from "../_shared/config-guard.ts";

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
    // Fase 2 — configGuard: respeita security/anomaly_detection_enabled e anomaly_threshold
    const { enabled, threshold } = await getAnomalyConfig();
    if (!enabled) {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: "anomaly_detection_enabled is false",
        }),
        { headers }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Call the check_and_alert_anomalies function
    const { error: rpcError } = await supabase.rpc("check_and_alert_anomalies");
    if (rpcError) throw rpcError;

    // Also run detect_access_anomalies to return current anomalies
    const { data: anomalies, error: detectError } = await supabase.rpc("detect_access_anomalies");
    if (detectError) throw detectError;

    // Filtra anomalias por threshold configurável (default 5).
    // Mantém compat: se a RPC já retorna campo numérico (count/severity), usa-o;
    // caso contrário, deixa todas passarem (não regride).
    const list = Array.isArray(anomalies) ? anomalies : [];
    const filtered = list.filter((a: any) => {
      const score = Number(a?.count ?? a?.score ?? a?.severity);
      return Number.isFinite(score) ? score >= threshold : true;
    });

    // Log execution
    await supabase.from("activity_logs").insert({
      action: "ai_detect_access_anomaly_executed",
      module: "ia_governance",
      details: {
        anomalies_found: filtered.length,
        anomalies_total: list.length,
        threshold_applied: threshold,
        trigger: "edge_function",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        threshold,
        anomalies_found: filtered.length,
        anomalies: filtered,
        message: filtered.length
          ? `${filtered.length} anomalia(s) detectada(s). Alertas enviados aos administradores.`
          : "Nenhuma anomalia detectada no período analisado.",
      }),
      { headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers }
    );
  }
});
