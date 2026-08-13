import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";
import { shouldLogAIDecision } from "../_shared/ai-log-guard.ts";
import { guardFeatureFlag } from "../_shared/feature-flag-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuth(async (req, ctx) => {
  // Feature flag guard: automated_evaluation
  const flagBlock = await guardFeatureFlag("automated_evaluation");
  if (flagBlock) return flagBlock;

  const startTime = Date.now();

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { step_response_id, application_id, media_type, media_url } = await req.json();
    if (!step_response_id || !application_id) {
      return new Response(JSON.stringify({ error: "step_response_id and application_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the application belongs to this user
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .select("candidate_id")
      .eq("id", application_id)
      .single();
    if (appErr || !app || app.candidate_id !== ctx.userId) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load step response
    const { data: stepResponse, error: srErr } = await supabase
      .from("step_responses")
      .select("*, pipeline_steps(*)")
      .eq("id", step_response_id)
      .single();
    if (srErr || !stepResponse) {
      return new Response(JSON.stringify({ error: "Step response not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let textToEvaluate = "";
    const stepType = (stepResponse as any).pipeline_steps?.type || "texto";

    // For media types, transcribe first
    if (media_type === "audio" || media_type === "video") {
      if (!media_url) {
        // If no media URL, score as delivery = 100
        await supabase.from("step_responses")
          .update({ score: 100, evaluated_at: new Date().toISOString() })
          .eq("id", step_response_id);
        return new Response(JSON.stringify({ final_score: 100, decision: "delivered", explanation: "Mídia entregue com sucesso." }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Transcribe via Whisper
      try {
        const mediaResponse = await fetch(media_url);
        const mediaBlob = await mediaResponse.blob();
        const formData = new FormData();
        formData.append("file", mediaBlob, `recording.${media_type === "audio" ? "webm" : "mp4"}`);
        formData.append("model", "whisper-1");
        formData.append("language", "pt");

        const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
          body: formData,
        });

        if (!whisperRes.ok) {
          console.error("Whisper error:", await whisperRes.text());
          // Fallback: score as delivered
          await supabase.from("step_responses")
            .update({ score: 100, evaluated_at: new Date().toISOString() })
            .eq("id", step_response_id);
          return new Response(JSON.stringify({ final_score: 100, decision: "delivered", explanation: "Transcrição falhou, mídia entregue." }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const whisperData = await whisperRes.json();
        textToEvaluate = whisperData.text || "";

        if (!textToEvaluate.trim()) {
          await supabase.from("step_responses")
            .update({ score: 100, evaluated_at: new Date().toISOString() })
            .eq("id", step_response_id);
          return new Response(JSON.stringify({ final_score: 100, decision: "delivered", explanation: "Áudio sem fala detectada." }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.error("Transcription error:", e);
        await supabase.from("step_responses")
          .update({ score: 100, evaluated_at: new Date().toISOString() })
          .eq("id", step_response_id);
        return new Response(JSON.stringify({ final_score: 100, decision: "delivered" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (media_type === "imagem") {
      // Images: score = 100 on delivery
      await supabase.from("step_responses")
        .update({ score: 100, evaluated_at: new Date().toISOString() })
        .eq("id", step_response_id);
      return new Response(JSON.stringify({ final_score: 100, decision: "delivered", explanation: "Imagem entregue." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // Text step
      textToEvaluate = JSON.stringify(stepResponse.response);
    }

    // Load settings
    const { data: aiSettings } = await supabase.from("global_settings").select("key, value").eq("category", "ai");
    const { data: govSettings } = await supabase.from("global_settings").select("key, value").eq("category", "ai_governance");
    const { data: pipelineSettings } = await supabase.from("global_settings").select("key, value").eq("category", "pipelines");

    const getConfig = (key: string, fallback: any) => {
      const s = aiSettings?.find((s: any) => s.key === key);
      return s ? s.value : fallback;
    };
    const getGov = (key: string, fallback: any) => {
      const s = govSettings?.find((s: any) => s.key === key);
      if (!s) return fallback;
      const v = s.value;
      if (typeof v === "string") { if (v === "true") return true; if (v === "false") return false; return v.replace(/"/g, ""); }
      return v;
    };
    const getPipeline = (key: string, fallback: any) => {
      const s = pipelineSettings?.find((s: any) => s.key === key);
      if (!s) return fallback;
      const v = s.value;
      if (typeof v === "string") { if (v === "true") return true; if (v === "false") return false; }
      return v;
    };

    // Item 3: Check if AI evaluation is enabled
    const aiEvaluationEnabled = getPipeline("ai_evaluation_enabled", true);
    if (aiEvaluationEnabled === false) {
      return new Response(JSON.stringify({
        skipped: true,
        reason: "AI evaluation is disabled via CrossConfig (pipelines.ai_evaluation_enabled = false)",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = getGov("ai_model_default", "gpt-4o-mini");
    const weights = [
      { key: "communication", weight: Number(getConfig("weight_communication", 25)) },
      { key: "clarity", weight: Number(getConfig("weight_clarity", 25)) },
      { key: "coherence", weight: Number(getConfig("weight_coherence", 25)) },
      { key: "role_fit", weight: Number(getConfig("weight_role_fit", 25)) },
    ];

    // Load active prompt
    const { data: promptVersion } = await supabase
      .from("ai_prompt_versions")
      .select("prompt_text, version")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const systemPrompt = promptVersion?.prompt_text || String(getConfig("base_prompt", "")) ||
      `Você é um avaliador profissional de entrevistas corporativas.

NUNCA avalie por igualdade textual. Avalie por entendimento semântico.

REGRAS DE AVALIAÇÃO:
1. O candidato NÃO precisa usar as mesmas palavras.
2. Sinônimos e explicações próprias são válidas.
3. Considere erros pequenos de transcrição de voz.
4. Avalie INTENÇÃO, não frase literal.
5. Se o conceito estiver implícito, considere correto.
6. Penalize apenas quando houver entendimento errado.

Avalie a resposta nos critérios (0-100 cada):
- communication: Qualidade da comunicação
- clarity: Clareza e objetividade
- coherence: Coerência e consistência
- role_fit: Adequação ao perfil do cargo

Responda APENAS em JSON: {"scores":{"communication":80,"clarity":75,"coherence":85,"role_fit":70},"strengths":["..."],"risks":["..."],"explanation":"...","nivel_entendimento":"baixo | medio | alto"}`;

    const stepTitle = (stepResponse as any).pipeline_steps?.title || "Etapa";

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt + "\n\nResponda APENAS em formato JSON." },
          { role: "user", content: `Etapa: ${stepTitle}\n\nResposta do candidato:\n${textToEvaluate}\n\nRetorne sua avaliação em JSON.` },
        ],
      }),
    });

    if (!openaiRes.ok) {
      console.error("OpenAI error:", await openaiRes.text());
      throw new Error("AI evaluation service unavailable");
    }

    const openaiResult = await openaiRes.json();
    const rawContent = openaiResult.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI returned empty response");
    const aiContent = JSON.parse(rawContent);

    // Calculate weighted score
    const criteriaScores: Record<string, number> = {};
    let weightedSum = 0, totalWeight = 0;
    for (const w of weights) {
      const score = Math.max(0, Math.min(100, Number(aiContent.scores?.[w.key] ?? 50)));
      criteriaScores[w.key] = score;
      weightedSum += score * w.weight;
      totalWeight += w.weight;
    }
    const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    const approveThreshold = Number(getConfig("auto_approve_threshold", 85));
    const rejectThreshold = Number(getConfig("auto_reject_threshold", 40));

    let decision = finalScore >= approveThreshold ? "approved" : finalScore <= rejectThreshold ? "rejected" : "review";

    // Governance: always escalate if autonomy=suggest
    const autonomy = getGov("ai_max_autonomy", "suggest");
    if (autonomy === "suggest") decision = "review";

    const processingTime = Date.now() - startTime;

    // Save evaluation
    const { data: evaluation } = await supabase.from("ai_evaluations").insert({
      step_response_id,
      application_id,
      criteria_scores: criteriaScores,
      final_score: finalScore,
      decision,
      strengths: aiContent.strengths || [],
      risks: aiContent.risks || [],
      explanation: aiContent.explanation || "",
      prompt_version: promptVersion ? `v${promptVersion.version}` : "default",
      model_provider: "openai",
      model_version: model,
      processing_time_ms: processingTime,
    }).select().single();

    // Update step_response score
    await supabase.from("step_responses")
      .update({ score: finalScore, evaluated_at: new Date().toISOString() })
      .eq("id", step_response_id);

    // Recalculate applications.total_score (weighted average of all evaluated step scores)
    try {
      const { data: allResponses } = await supabase
        .from("step_responses")
        .select("score, pipeline_steps(weight)")
        .eq("application_id", application_id)
        .not("score", "is", null);
      if (allResponses && allResponses.length > 0) {
        let wSum = 0, wTotal = 0;
        for (const r of allResponses) {
          const w = (r as any).pipeline_steps?.weight || 1;
          wSum += Number(r.score) * w;
          wTotal += w;
        }
        const totalScore = wTotal > 0 ? Math.round(wSum / wTotal) : 0;
        await supabase.from("applications").update({ total_score: totalScore }).eq("id", application_id);
      }
    } catch (e) {
      console.error("Failed to recalculate total_score:", e);
    }

    // Audit logs
    const { data: appData } = await supabase
      .from("applications")
      .select("candidate_id, profiles:candidate_id(cpf)")
      .eq("id", application_id)
      .single();

    const cpf = (appData as any)?.profiles?.cpf;
    if (cpf && evaluation) {
      // Item 5: Check if AI decision logging is enabled
      const shouldLog = await shouldLogAIDecision();
      if (shouldLog) {
        await supabase.from("ai_decision_logs").insert({
          cpf,
          module: "recrutamento",
          input: { step_title: stepTitle, candidate_response: textToEvaluate.slice(0, 500) },
          output: { ...aiContent, final_decision: decision },
          decision_type: decision === "rejected" ? "bloqueio" : decision === "approved" ? "recomendacao" : "analise",
          model_provider: "openai",
          model_version: model,
          application_id,
          evaluation_id: evaluation.id,
          actor_id: ctx.userId,
          processing_time_ms: processingTime,
        });
      }

      await supabase.from("candidate_progress_logs").insert({
        candidate_id: (appData as any)?.candidate_id,
        application_id,
        phase: stepTitle,
        score: finalScore,
        decision: decision === "approved" ? "aprovado" : decision === "rejected" ? "standby" : "escalar",
        rule_applied: `auto_evaluate:approve=${approveThreshold},reject=${rejectThreshold}`,
        metadata: { criteria_scores: criteriaScores, evaluation_id: evaluation?.id },
      });
    }

    return new Response(JSON.stringify({
      final_score: finalScore,
      decision,
      criteria_scores: criteriaScores,
      explanation: aiContent.explanation || "",
      evaluation_id: evaluation?.id,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auto-evaluate-response error:", err);
    return new Response(JSON.stringify({ error: "Evaluation failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
