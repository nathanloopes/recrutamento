import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * feature-flag-ai-analysis
 * Handles 3 IA prompts required by Doc 3.9:
 * 1. "evaluate_activation_impact" — avaliar impacto da ativação
 * 2. "generate_module_usage_report" — gerar relatório de uso do módulo
 * 3. "suggest_gradual_rollout" — sugerir módulos para rollout gradual
 */
Deno.serve(withAuth(async (req, ctx) => {
  const startTime = Date.now();

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, context: actionContext } = await req.json();
    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load feature flags and activation logs for context
    const { data: flags } = await supabase
      .from("feature_flags")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: recentLogs } = await supabase
      .from("module_activation_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    let systemPrompt = "";
    let userPrompt = "";

    switch (action) {
      case "evaluate_activation_impact": {
        const { module_key, new_state, previous_state } = actionContext || {};
        systemPrompt = `Você é um analista de sistemas da rede Recruta. Avalie o impacto da ativação/desativação de um módulo no sistema. Considere dependências, riscos e benefícios. Retorne JSON: { "risk_level": "alto|medio|baixo", "impact_summary": "...", "dependencies_affected": ["..."], "recommendations": ["..."], "rollback_advised": boolean }`;
        userPrompt = `Módulo: ${module_key || "N/A"}\nEstado anterior: ${previous_state || "N/A"}\nNovo estado: ${new_state || "N/A"}\n\nFlags atuais:\n${JSON.stringify((flags || []).map((f: any) => ({ key: f.module_key, enabled: f.is_enabled })), null, 2)}\n\nÚltimas ativações:\n${JSON.stringify((recentLogs || []).slice(0, 10).map((l: any) => ({ module: l.module_key, action: l.action, date: l.created_at })), null, 2)}\n\nAvalie o impacto.`;
        break;
      }
      case "generate_module_usage_report": {
        const { period } = actionContext || {};
        systemPrompt = `Você é um analista de dados da rede Recruta. Gere um relatório de uso dos módulos do sistema baseado nos logs de ativação. Retorne JSON: { "summary": "...", "most_toggled_modules": ["..."], "stability_score": number, "recommendations": ["..."] }`;
        userPrompt = `Período: ${period || "último mês"}\n\nFlags existentes:\n${JSON.stringify((flags || []).map((f: any) => ({ key: f.module_key, enabled: f.is_enabled, rollout: f.rollout_percentage })), null, 2)}\n\nLogs de ativação (últimos 50):\n${JSON.stringify((recentLogs || []).map((l: any) => ({ module: l.module_key, action: l.action, date: l.created_at })), null, 2)}\n\nGere o relatório.`;
        break;
      }
      case "suggest_gradual_rollout": {
        systemPrompt = `Você é um engenheiro de release da rede Recruta. Analise os módulos do sistema e sugira quais devem ser implantados com rollout gradual (percentual progressivo por região ou role). Retorne JSON: { "suggestions": [{ "module_key": "...", "reason": "...", "recommended_rollout_strategy": "...", "initial_percentage": number }] }`;
        userPrompt = `Flags atuais:\n${JSON.stringify((flags || []).map((f: any) => ({ key: f.module_key, enabled: f.is_enabled, rollout: f.rollout_percentage, scope: f.rollout_scope })), null, 2)}\n\nLogs recentes:\n${JSON.stringify((recentLogs || []).slice(0, 20).map((l: any) => ({ module: l.module_key, action: l.action, date: l.created_at })), null, 2)}\n\nSugira módulos para rollout gradual.`;
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text();
      console.error("[feature-flag-ai-analysis] OpenAI error:", errBody);
      throw new Error("AI service unavailable");
    }

    const aiResult = await openaiRes.json();
    const content = aiResult.choices?.[0]?.message?.content;
    let parsed: any = {};
    try { parsed = JSON.parse(content || "{}"); } catch { parsed = { raw: content }; }

    const processingTime = Date.now() - startTime;

    // Log AI decision
    await supabase.from("activity_logs").insert({
      action: `feature_flag_ai_${action}`,
      module: "feature_flags",
      details: { action, processing_time_ms: processingTime, result_summary: parsed.summary || parsed.risk_level || "completed" },
    });

    return new Response(JSON.stringify({ success: true, result: parsed, processing_time_ms: processingTime }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[feature-flag-ai-analysis] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
