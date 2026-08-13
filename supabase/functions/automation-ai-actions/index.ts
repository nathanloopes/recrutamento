import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * automation-ai-actions
 * Handles 3 IA prompts required by Doc 3.8:
 * 1. "generate_educational_content" — gerar conteúdo educativo baseado no erro
 * 2. "classify_candidate_fit" — classificar candidato por aderência
 * 3. "generate_institutional_message" — gerar mensagem institucional personalizada
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

    // Read tone/language from CrossConfig
    const { data: tlSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "units")
      .in("key", ["default_tone", "default_language"]);
    const tlMap: Record<string, any> = {};
    (tlSettings || []).forEach((s: any) => { tlMap[s.key] = s.value; });
    const tone = typeof tlMap.default_tone === "string" ? tlMap.default_tone.replace(/"/g, "") : "formal";
    const language = typeof tlMap.default_language === "string" ? tlMap.default_language.replace(/"/g, "") : "pt-BR";

    const toneInstr = tone === "informal" ? "tom descontraído e amigável" : tone === "técnico" ? "tom técnico e preciso" : "tom profissional e respeitoso";
    const langInstr = language === "pt-BR" ? "português brasileiro" : language;

    let systemPrompt = "";
    let userPrompt = "";

    switch (action) {
      case "generate_educational_content": {
        const { candidate_name, error_type, score, step_title } = actionContext || {};
        systemPrompt = `Você é um coach de carreira da rede Recruta. Gere um conteúdo educativo curto (máximo 3 parágrafos) para ajudar o candidato a melhorar. Use ${toneInstr}. Responda em ${langInstr}. Retorne JSON: { "title": "...", "content": "...", "tips": ["..."] }`;
        userPrompt = `Candidato: ${candidate_name || "Candidato"}\nErro identificado: ${error_type || "desempenho abaixo do esperado"}\nEtapa: ${step_title || "Triagem"}\nScore: ${score || "N/A"}\n\nGere conteúdo educativo personalizado.`;
        break;
      }
      case "classify_candidate_fit": {
        const { candidate_name, job_title, scores, profile_data } = actionContext || {};
        systemPrompt = `Você é um analista de RH da rede Recruta. Classifique a aderência do candidato ao cargo. Use ${toneInstr}. Responda em ${langInstr}. Retorne JSON: { "fit_level": "alto|medio|baixo", "justification": "...", "recommendations": ["..."] }`;
        userPrompt = `Candidato: ${candidate_name || "N/A"}\nCargo: ${job_title || "N/A"}\nScores: ${JSON.stringify(scores || {})}\nPerfil: ${JSON.stringify(profile_data || {})}\n\nClassifique a aderência.`;
        break;
      }
      case "generate_institutional_message": {
        const { recipient_name, event_type, context: msgContext } = actionContext || {};
        systemPrompt = `Você é o redator institucional da rede Recruta. Gere uma mensagem personalizada para o destinatário. Use ${toneInstr}. Responda em ${langInstr}. Retorne JSON: { "subject": "...", "body": "...", "cta_text": "..." }`;
        userPrompt = `Destinatário: ${recipient_name || "Candidato"}\nEvento: ${event_type || "geral"}\nContexto: ${JSON.stringify(msgContext || {})}\n\nGere a mensagem institucional personalizada.`;
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
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text();
      console.error("[automation-ai-actions] OpenAI error:", errBody);
      throw new Error("AI service unavailable");
    }

    const aiResult = await openaiRes.json();
    const content = aiResult.choices?.[0]?.message?.content;
    let parsed: any = {};
    try { parsed = JSON.parse(content || "{}"); } catch { parsed = { raw: content }; }

    const processingTime = Date.now() - startTime;

    // Log AI decision
    await supabase.from("activity_logs").insert({
      action: `automation_ai_${action}`,
      module: "automacao",
      details: { action, processing_time_ms: processingTime, result: parsed },
    });

    return new Response(JSON.stringify({ success: true, result: parsed, processing_time_ms: processingTime }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[automation-ai-actions] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
