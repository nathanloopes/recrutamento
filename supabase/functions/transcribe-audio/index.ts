import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuth(async (req, ctx) => {
  const startTime = Date.now();

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { application_id, step_id, audio_urls, questions } = await req.json();
    if (!application_id || !step_id) {
      return new Response(JSON.stringify({ error: "application_id and step_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: application, error: applicationError } = await supabase
      .from("applications")
      .select("candidate_id")
      .eq("id", application_id)
      .single();

    if (applicationError || !application || application.candidate_id !== ctx.userId) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Transcribe each audio using OpenAI Whisper
    const transcriptions: Record<string, string> = {};
    const audioEntries = Object.entries(audio_urls || {}).slice(0, 20); // Limit to 20 audio files max

    for (const [questionId, audioUrl] of audioEntries) {
      try {
        // Download audio from Supabase storage
        const { data: audioData, error: dlErr } = await supabase.storage
          .from("voice-recordings")
          .download(audioUrl as string);

        if (dlErr || !audioData) {
          console.error(`Failed to download audio for ${questionId}:`, dlErr);
          transcriptions[questionId] = "[Erro na transcrição: áudio não encontrado]";
          continue;
        }

        // Send to OpenAI Whisper
        const formData = new FormData();
        formData.append("file", audioData, `${questionId}.webm`);
        formData.append("model", "whisper-1");
        formData.append("language", "pt");
        formData.append("response_format", "text");

        const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
          },
          body: formData,
        });

        if (!whisperResponse.ok) {
          const errText = await whisperResponse.text();
          console.error(`Whisper error for ${questionId}:`, errText);
          transcriptions[questionId] = "[Erro na transcrição]";
          continue;
        }

        const transcription = await whisperResponse.text();
        transcriptions[questionId] = transcription.trim();
      } catch (e) {
        console.error(`Transcription error for ${questionId}:`, e);
        transcriptions[questionId] = "[Erro na transcrição]";
      }
    }

    // Save step_response
    const { data: existingResponse } = await supabase
      .from("step_responses")
      .select("id")
      .eq("application_id", application_id)
      .eq("step_id", step_id)
      .maybeSingle();

    let stepResponseId: string;
    const responseData = {
      type: "entrevista_voz",
      audio_urls: audio_urls || {},
      transcriptions,
      questions: questions || [],
    };

    if (existingResponse) {
      stepResponseId = existingResponse.id;
      await supabase
        .from("step_responses")
        .update({ response: responseData })
        .eq("id", stepResponseId);
    } else {
      const { data: newResp, error: insertErr } = await supabase
        .from("step_responses")
        .insert({ application_id, step_id, response: responseData })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      stepResponseId = newResp.id;
    }

    // Load governance settings for dynamic model
    const { data: govSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "ai_governance");

    const getGovVal = (key: string, fallback: string) => {
      const s = govSettings?.find((s: any) => s.key === key);
      if (!s) return fallback;
      const v = s.value;
      return typeof v === "string" ? v.replace(/"/g, "") : String(v);
    };

    const aiModel = getGovVal("ai_model_default", "gpt-4o-mini");
    const requireHumanValidation = getGovVal("require_human_validation", "false") === "true";
    const aiEliminationAllowed = getGovVal("ai_elimination_allowed", "true") === "true";
    const escalationOnInconsistency = getGovVal("escalation_on_inconsistency", "true") === "true";
    const escalationScoreMargin = Number(getGovVal("escalation_score_margin", "10"));

    // AI evaluation of transcriptions using GPT
    const questionsContext = (questions || [])
      .map((q: any, i: number) => `Pergunta ${i + 1}: ${q.text}\nResposta: ${transcriptions[q.id] || "[sem resposta]"}`)
      .join("\n\n");

    const evalPrompt = `Você é um avaliador profissional de entrevistas corporativas para a rede Recruta.

NUNCA avalie por igualdade textual. Avalie por entendimento semântico.

REGRAS DE AVALIAÇÃO:
1. O candidato NÃO precisa usar as mesmas palavras.
2. Sinônimos e explicações próprias são válidas.
3. Considere erros pequenos de transcrição de voz.
4. Avalie INTENÇÃO, não frase literal.
5. Se o conceito estiver implícito, considere correto.
6. Penalize apenas quando houver entendimento errado.

Avalie as respostas da entrevista de voz:

${questionsContext}

Avalie nos critérios (0-100 cada):
- communication: Comunicação verbal
- clarity: Clareza e objetividade
- coherence: Coerência argumentativa
- role_fit: Aderência ao perfil

Responda APENAS em JSON:
{"scores":{"communication":80,"clarity":75,"coherence":85,"role_fit":70},"strengths":["..."],"risks":["..."],"explanation":"...","nivel_entendimento":"baixo | medio | alto"}`;

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: evalPrompt },
          { role: "user", content: "Avalie as respostas acima e retorne o resultado em JSON." },
        ],
      }),
    });

    let criteriaScores: Record<string, number>;
    let finalScore: number;
    let decision: string;
    let strengths: string[];
    let risks: string[];
    let explanation: string;

    if (gptResponse.ok) {
      const gptResult = await gptResponse.json();
      const aiContent = JSON.parse(gptResult.choices[0].message.content);

      criteriaScores = {};
      let weightedSum = 0;
      const criteriaKeys = ["communication", "clarity", "coherence", "role_fit"];
      for (const key of criteriaKeys) {
        const score = Math.max(0, Math.min(100, Number(aiContent.scores?.[key] ?? 50)));
        criteriaScores[key] = score;
        weightedSum += score;
      }
      finalScore = Math.round(weightedSum / criteriaKeys.length);

      strengths = aiContent.strengths || [];
      risks = aiContent.risks || [];
      explanation = aiContent.explanation || `Score: ${finalScore}`;
    } else {
      const errText = await gptResponse.text();
      console.error("GPT evaluation error:", errText);
      // Fallback
      criteriaScores = { communication: 60, clarity: 60, coherence: 60, role_fit: 60 };
      finalScore = 60;
      strengths = ["Avaliação automática indisponível"];
      risks = ["Requer avaliação humana"];
      explanation = "Falha na avaliação automática. Recomendada avaliação manual.";
    }

    // Load voice config
    const { data: voiceSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "voice");

    const getVoiceConfig = (key: string, fallback: number) => {
      const s = voiceSettings?.find((s: any) => s.key === key);
      return s ? Number(s.value) : fallback;
    };

    const minScore = getVoiceConfig("min_voice_score", 60);

    if (finalScore >= 85) {
      decision = "approved_next_stage";
    } else if (finalScore < minScore) {
      decision = "rejected";
    } else if (finalScore >= 70) {
      decision = "escalate_human";
    } else {
      decision = "repeat_stage";
    }

    // Apply governance overrides
    const governanceOverrides: string[] = [];

    if (requireHumanValidation && (decision === "approved_next_stage" || decision === "rejected")) {
      governanceOverrides.push(`require_human_validation: ${decision} -> escalate_human`);
      decision = "escalate_human";
    }

    if (!aiEliminationAllowed && decision === "rejected") {
      governanceOverrides.push(`ai_elimination_blocked: rejected -> escalate_human`);
      decision = "escalate_human";
    }

    if (escalationScoreMargin > 0) {
      const nearApprove = Math.abs(finalScore - 85) <= escalationScoreMargin && finalScore < 85;
      const nearReject = Math.abs(finalScore - minScore) <= escalationScoreMargin && finalScore > minScore;
      if ((nearApprove || nearReject) && decision !== "escalate_human") {
        governanceOverrides.push(`score_margin: ${decision} -> escalate_human`);
        decision = "escalate_human";
      }
    }

    if (escalationOnInconsistency && criteriaScores) {
      const scores = Object.values(criteriaScores);
      const maxS = Math.max(...scores);
      const minS = Math.min(...scores);
      if (maxS - minS > 30 && decision !== "escalate_human") {
        governanceOverrides.push(`inconsistency: spread=${maxS - minS}pts`);
        decision = "escalate_human";
      }
    }

    const processingTime = Date.now() - startTime;

    // Save AI evaluation
    await supabase.from("ai_evaluations").insert({
      step_response_id: stepResponseId,
      application_id,
      criteria_scores: criteriaScores,
      final_score: finalScore,
      decision,
      strengths,
      risks,
      explanation,
      model_provider: "openai",
      model_version: `${aiModel}+whisper-1`,
      processing_time_ms: processingTime,
    });

    // Update step_response score
    await supabase
      .from("step_responses")
      .update({ score: finalScore, evaluated_at: new Date().toISOString() })
      .eq("id", stepResponseId);

    return new Response(
      JSON.stringify({
        success: true,
        final_score: finalScore,
        decision,
        transcriptions,
        criteria_scores: criteriaScores,
        strengths,
        risks,
        explanation,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("transcribe-audio error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
