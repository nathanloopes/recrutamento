import { withAuth } from "../_shared/with-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { guardFeatureFlag } from "../_shared/feature-flag-guard.ts";

/**
 * Edge Function: summarize-interview-ai
 * Item 23 — AI-powered post-interview summary generation
 *
 * Takes an interview_id, gathers all feedback/checklist data,
 * and generates a structured AI summary for the franchisor dashboard.
 */

interface SummarizeRequest {
  interview_id: string;
}

Deno.serve(withAuth(async (req, ctx) => {
  // Feature flag guard: human_interview
  const flagBlock = await guardFeatureFlag("human_interview");
  if (flagBlock) return flagBlock;

  const startTime = Date.now();

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: corsHeaders,
      });
    }

    const { interview_id }: SummarizeRequest = await req.json();
    if (!interview_id) {
      return new Response(JSON.stringify({ error: "interview_id required" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Fetch interview with related data
    const { data: interview, error: intErr } = await ctx.admin
      .from("interviews")
      .select(`
        *,
        profiles:candidate_id(full_name, cpf),
        applications:application_id(
          id, status, total_score,
          unit_jobs:unit_job_id(
            jobs:job_id(title),
            units:unit_id(name)
          )
        )
      `)
      .eq("id", interview_id)
      .single();

    if (intErr || !interview) {
      return new Response(JSON.stringify({ error: "Interview not found" }), {
        status: 404, headers: corsHeaders,
      });
    }

    // Fetch interview feedback
    const { data: feedback } = await ctx.admin
      .from("interview_feedback")
      .select("*")
      .eq("interview_id", interview_id)
      .maybeSingle();

    if (!feedback) {
      return new Response(JSON.stringify({ error: "No feedback found for this interview" }), {
        status: 404, headers: corsHeaders,
      });
    }

    // Fetch AI evaluations for the application
    const { data: aiEvals } = await ctx.admin
      .from("ai_evaluations")
      .select("final_score, decision, strengths, risks, explanation, criteria_scores")
      .eq("application_id", (interview as any).application_id)
      .order("created_at", { ascending: false })
      .limit(3);

    // Build context for the AI
    const candidateName = (interview as any).profiles?.full_name || "Candidato";
    const jobTitle = (interview as any).applications?.unit_jobs?.jobs?.title || "Cargo";
    const unitName = (interview as any).applications?.unit_jobs?.units?.name || "Unidade";
    const checklistJson = (feedback as any).checklist_json || {};
    const decision = (feedback as any).decision || "sem_decisao";
    const notes = (feedback as any).notes || "";

    const contextPayload = {
      candidato: candidateName,
      cargo: jobTitle,
      unidade: unitName,
      decisao: decision,
      notas: notes,
      checklist: checklistJson,
      avaliacoes_ia: (aiEvals || []).map((e: any) => ({
        score: e.final_score,
        decisao: e.decision,
        pontos_fortes: e.strengths,
        riscos: e.risks,
        explicacao: e.explanation,
      })),
    };

    // Call OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Você é um analista de RH que gera resumos pós-entrevista para gestores de franquias.

Gere um resumo estruturado em JSON:
{
  "resumo_executivo": "2-3 frases resumindo o candidato e a decisão",
  "pontos_fortes": ["lista de pontos fortes identificados"],
  "pontos_atencao": ["lista de pontos de atenção ou riscos"],
  "adequacao_perfil": "alta | media | baixa",
  "recomendacao": "contratar | standby | encerrar",
  "justificativa_recomendacao": "explicação da recomendação",
  "sugestoes_proximos_passos": ["lista de próximos passos recomendados"],
  "score_geral": 0-100,
  "tags": ["tags relevantes para busca futura"]
}

Regras:
- Nunca use o termo "reprovado" — use "standby" ou "encerrado"
- Seja objetivo e factual
- Base sua análise nos dados reais do checklist e avaliações
- Se os dados forem insuficientes, indique isso no resumo`,
          },
          {
            role: "user",
            content: `Dados da entrevista:\n${JSON.stringify(contextPayload, null, 2)}`,
          },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text();
      console.error("[summarize-interview-ai] OpenAI error:", errBody);
      throw new Error("AI summary service unavailable");
    }

    const aiResult = await openaiResponse.json();
    const rawContent = aiResult.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI returned empty response");
    const summary = JSON.parse(rawContent);

    const processingTime = Date.now() - startTime;

    // Store summary in activity_logs
    await ctx.admin.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "ai_interview_summary_generated",
      module: "entrevista_guiada",
      details: {
        interview_id,
        application_id: (interview as any).application_id,
        candidate_name: candidateName,
        summary,
        processing_time_ms: processingTime,
      },
    });

    // Log to ai_decision_logs
    const cpf = (interview as any).profiles?.cpf;
    if (cpf) {
      await ctx.admin.from("ai_decision_logs").insert({
        cpf,
        module: "entrevista_guiada",
        decision_type: "resumo",
        input: contextPayload,
        output: summary,
        model_provider: "openai",
        model_version: "gpt-4o-mini",
        actor_id: ctx.userId,
        application_id: (interview as any).application_id,
        processing_time_ms: processingTime,
      });
    }

    return new Response(JSON.stringify({
      interview_id,
      summary,
      processing_time_ms: processingTime,
    }), {
      status: 200, headers: corsHeaders,
    });
  } catch (err) {
    console.error("[summarize-interview-ai] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Internal error" }), {
      status: 500, headers: corsHeaders,
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora", "franqueado"] }));
