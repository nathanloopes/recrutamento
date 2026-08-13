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
    const { activity_log_id } = await req.json();
    if (!activity_log_id) {
      return new Response(JSON.stringify({ error: "activity_log_id obrigatório" }), { status: 400, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch the activity log entry
    const { data: log, error: logError } = await supabase
      .from("activity_logs")
      .select("*")
      .eq("id", activity_log_id)
      .single();
    if (logError) throw logError;

    // Resolve actor name
    let actorName = "Sistema";
    if (log.user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", log.user_id)
        .single();
      actorName = profile?.full_name || "Desconhecido";
    }

    // Generate explanation (deterministic, no AI key required)
    const details = log.details as Record<string, any> || {};
    const action = log.action || "";
    
    let explanation = "";
    if (action.startsWith("role_assigned")) {
      explanation = `${actorName} atribuiu a role "${details.role}" ao usuário ${details.target_user_id}. Escopo: ${details.scope_access || "global"}. ${details.unit_id ? `Unidade: ${details.unit_id}` : "Sem unidade vinculada."}`;
    } else if (action.startsWith("role_removed")) {
      explanation = `${actorName} removeu a role "${details.role}" do usuário ${details.target_user_id}. ${details.reason ? `Motivo: ${details.reason}` : "Sem motivo informado."}`;
    } else if (action.startsWith("role_changed")) {
      explanation = `${actorName} alterou a role do usuário ${details.target_user_id} de "${details.old_role}" para "${details.new_role}". Escopo: ${details.scope_access || "N/A"}.`;
    } else if (action === "scope_updated") {
      explanation = `${actorName} atualizou o escopo do usuário ${details.target_user_id} para "${details.scope_access}". ${details.unit_id ? `Unidade: ${details.unit_id}` : ""}`;
    } else if (action === "user_deactivated") {
      explanation = `${actorName} desativou o usuário ${details.target_user_id}. Status: ${details.user_status || "inativo"}. Motivo: ${details.reason || "Não informado"}.`;
    } else if (action === "user_activated") {
      explanation = `${actorName} reativou o usuário ${details.target_user_id}.`;
    } else if (action === "permission_override") {
      explanation = `${actorName} alterou uma permissão granular. Módulo: ${details.module_name || "N/A"}. Ação: ${details.action_name || "N/A"}. Justificativa: ${details.override_reason || "Não informada"}.`;
    } else {
      explanation = `Ação "${action}" executada por ${actorName} no módulo "${log.module || "N/A"}". Detalhes: ${JSON.stringify(details).substring(0, 300)}`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        activity_log_id,
        actor: actorName,
        action: log.action,
        module: log.module,
        timestamp: log.created_at,
        explanation,
      }),
      { headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers }
    );
  }
});
