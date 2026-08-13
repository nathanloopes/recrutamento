// Pipeline AI Evaluator (RecrutaBot Layer) v6.1
// Avalia respostas de etapas (texto/áudio/vídeo) via Lovable AI Gateway.
// - Honra global_settings.pipelines.ai_evaluation_enabled (fail-safe)
// - Honra global_settings.pipelines.require_score_justification
// - Persiste 100% das chamadas em pipeline_ai_logs (auditável)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  application_id: string;
  step_id: string;
  candidate_input: {
    type: "text" | "audio_url" | "video_url";
    value: string;
  };
  model?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validate(body: unknown): { ok: true; data: RequestBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body inválido" };
  const b = body as Record<string, any>;
  if (typeof b.application_id !== "string" || !b.application_id) return { ok: false, error: "application_id obrigatório" };
  if (typeof b.step_id !== "string" || !b.step_id) return { ok: false, error: "step_id obrigatório" };
  if (!b.candidate_input || typeof b.candidate_input !== "object") return { ok: false, error: "candidate_input obrigatório" };
  const ci = b.candidate_input;
  if (!["text", "audio_url", "video_url"].includes(ci.type)) return { ok: false, error: "candidate_input.type inválido" };
  if (typeof ci.value !== "string" || !ci.value.trim()) return { ok: false, error: "candidate_input.value vazio" };
  return { ok: true, data: b as RequestBody };
}

async function getCrossConfig(supabase: any, key: string, fallback: any) {
  try {
    const { data } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "pipelines")
      .eq("key", key)
      .maybeSingle();
    return data?.value ?? fallback;
  } catch {
    return fallback;
  }
}

Deno.serve(withAuth(async (req, _ctx) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const raw = await req.json().catch(() => null);
    const v = validate(raw);
    if (!v.ok) return json({ error: v.error }, 400);
    const { application_id, step_id, candidate_input, model } = v.data;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Fail-safe CrossConfig
    const enabled = await getCrossConfig(supabase, "ai_evaluation_enabled", true);
    if (enabled !== true && enabled !== "true") {
      return json({ error: "ai_evaluation_enabled está desativado" }, 503);
    }
    const requireJustification = await getCrossConfig(supabase, "require_score_justification", true);

    // Contexto: cargo + etapa + critérios
    const { data: step } = await supabase
      .from("pipeline_steps")
      .select("id, title, type, content, phase_id, pipeline_phases(pipeline_id, name, job_pipelines(job_id, jobs(title, description)))")
      .eq("id", step_id)
      .single();
    if (!step) return json({ error: "step não encontrado" }, 404);

    const { data: app } = await supabase
      .from("applications")
      .select("id, candidate_id")
      .eq("id", application_id)
      .single();
    if (!app) return json({ error: "application não encontrada" }, 404);

    const job = (step as any).pipeline_phases?.job_pipelines?.jobs;
    const evaluationCriteria = (step as any).content?.evaluation_criteria || (step as any).content?.criteria || "Avalie clareza, coerência, alinhamento ao perfil do cargo e profundidade.";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY não configurada" }, 500);
    }

    const systemPrompt = `Você é o RecrutaBot, avaliador institucional do Recruta.
Sua função é avaliar respostas de candidatos em etapas de pipelines de recrutamento.
Cargo avaliado: ${job?.title || "não especificado"}.
Descrição do cargo: ${job?.description || "—"}.
Critérios de avaliação: ${evaluationCriteria}.
Retorne SEMPRE via tool call, nunca em texto livre.`;

    const userContent = candidate_input.type === "text"
      ? `Resposta do candidato:\n\n"""\n${candidate_input.value}\n"""`
      : `Conteúdo enviado pelo candidato (${candidate_input.type}): ${candidate_input.value}\nAvalie o que for possível pelos metadados/transcrição associada.`;

    const aiBody = {
      model: model || "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "submit_evaluation",
            description: "Submete avaliação técnica do candidato",
            parameters: {
              type: "object",
              properties: {
                score: { type: "number", description: "Score 0-100" },
                justification: { type: "string", description: "Justificativa técnica auditável (mínimo 1 frase, citar critérios)" },
                strengths: { type: "array", items: { type: "string" } },
                weaknesses: { type: "array", items: { type: "string" } },
                alignment_to_role: { type: "string", enum: ["alto", "medio", "baixo"] },
              },
              required: ["score", "justification", "alignment_to_role"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "submit_evaluation" } },
    };

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aiBody),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text().catch(() => "");
      console.error("[ai-evaluator] gateway error:", aiResp.status, t);
      // log de falha auditável
      await supabase.from("pipeline_ai_logs").insert({
        pipeline_id: (step as any).pipeline_phases?.pipeline_id,
        phase_id: (step as any).phase_id,
        step_id,
        candidate_id: (app as any).candidate_id,
        ai_action: "ai_evaluation_failed",
        ai_result: { status: aiResp.status, error: t.slice(0, 500) },
      } as any);
      if (aiResp.status === 429) return json({ error: "Rate limit excedido. Tente em alguns segundos." }, 429);
      if (aiResp.status === 402) return json({ error: "Créditos da Lovable AI esgotados. Adicione créditos no workspace." }, 402);
      return json({ error: "Falha na avaliação por IA" }, 502);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      await supabase.from("pipeline_ai_logs").insert({
        pipeline_id: (step as any).pipeline_phases?.pipeline_id,
        phase_id: (step as any).phase_id,
        step_id,
        candidate_id: (app as any).candidate_id,
        ai_action: "ai_evaluation_no_tool",
        ai_result: { raw: aiJson },
      } as any);
      return json({ error: "IA não retornou avaliação estruturada" }, 502);
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(toolCall.function?.arguments || "{}");
    } catch {
      return json({ error: "IA retornou avaliação inválida" }, 502);
    }

    const score = Math.max(0, Math.min(100, Number(parsed.score || 0)));
    const justification = String(parsed.justification || "").trim();

    if (requireJustification && (!justification || justification.length < 10)) {
      // log mas rejeita
      await supabase.from("pipeline_ai_logs").insert({
        pipeline_id: (step as any).pipeline_phases?.pipeline_id,
        phase_id: (step as any).phase_id,
        step_id,
        candidate_id: (app as any).candidate_id,
        ai_action: "ai_evaluation_rejected_missing_justification",
        ai_result: parsed,
      } as any);
      return json({ error: "Justificativa obrigatória ausente ou muito curta" }, 422);
    }

    // Sucesso — log auditável completo
    const logResult = {
      score,
      justification,
      strengths: parsed.strengths || [],
      weaknesses: parsed.weaknesses || [],
      alignment_to_role: parsed.alignment_to_role,
      model: aiBody.model,
      usage: aiJson?.usage,
      candidate_input_type: candidate_input.type,
    };
    await supabase.from("pipeline_ai_logs").insert({
      pipeline_id: (step as any).pipeline_phases?.pipeline_id,
      phase_id: (step as any).phase_id,
      step_id,
      candidate_id: (app as any).candidate_id,
      ai_action: "ai_step_evaluation",
      ai_result: logResult,
    } as any);

    return json({
      ok: true,
      score,
      justification,
      strengths: logResult.strengths,
      weaknesses: logResult.weaknesses,
      alignment_to_role: logResult.alignment_to_role,
      model: aiBody.model,
    });
  } catch (e) {
    console.error("[ai-evaluator] fatal:", e);
    return json({ error: e instanceof Error ? e.message : "erro interno" }, 500);
  }
}, { allowedRoles: [] }));
