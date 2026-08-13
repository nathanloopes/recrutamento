import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";
import { guardFeatureFlag } from "../_shared/feature-flag-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * evaluate-test-voice
 *
 * Recebe audio_urls (map de question_id -> storage path ou URL),
 * transcreve via Whisper, avalia via GPT e retorna score.
 * test_assignment_id é OPCIONAL — para triage/cargo tests, funciona sem assignment.
 */
Deno.serve(withAuth(async (req, ctx) => {
  // Feature flag guard: ai_voice_interview
  const flagBlock = await guardFeatureFlag("ai_voice_interview");
  if (flagBlock) return flagBlock;

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { test_assignment_id, audio_urls, questions } = await req.json();

    if (!audio_urls || !questions) {
      return new Response(
        JSON.stringify({ error: "audio_urls and questions are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Assignment lookup is OPTIONAL — skip for triage/cargo flows
    let assignment: any = null;
    const isTriageMode = !test_assignment_id || test_assignment_id.startsWith("triage_");

    if (!isTriageMode) {
      const { data } = await supabase
        .from("test_assignments")
        .select("*, test_templates(*)")
        .eq("id", test_assignment_id)
        .single();
      assignment = data;
    }

    // Load voice settings
    const { data: voiceSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "voice")
      .in("key", ["min_voice_score", "voice_weight"]);

    const cfg: Record<string, any> = {};
    (voiceSettings || []).forEach((s: any) => { cfg[s.key] = s.value; });
    const minScore = Number(cfg.min_voice_score ?? 60);

    const startTime = Date.now();
    const questionResults: any[] = [];

    for (const q of questions) {
      const audioRef = audio_urls[q.id];
      if (!audioRef) {
        questionResults.push({ question_id: q.id, question_text: q.text, transcription: "", score: 0, error: "No audio" });
        continue;
      }

      // Download audio — use signed URL for private bucket paths
      let audioBlob: Blob | null = null;
      try {
        if (audioRef.startsWith("http://") || audioRef.startsWith("https://")) {
          // It's a full URL — try signed URL from storage if it's a supabase storage URL
          const audioResponse = await fetch(audioRef);
          if (audioResponse.ok) {
            audioBlob = await audioResponse.blob();
          }
        }

        // If direct fetch failed or it's a storage path, use signed URL
        if (!audioBlob || audioBlob.size === 0) {
          // Extract path: could be full URL or just a path
          let storagePath = audioRef;
          if (audioRef.includes("/voice-recordings/")) {
            storagePath = audioRef.split("/voice-recordings/").pop()!;
          }

          const { data: signedData, error: signedErr } = await supabase.storage
            .from("voice-recordings")
            .createSignedUrl(storagePath, 300); // 5 min expiry

          if (signedErr) {
            console.error("Signed URL error:", signedErr);
            questionResults.push({ question_id: q.id, question_text: q.text, transcription: "", score: 0, error: "Audio access failed" });
            continue;
          }

          const audioResponse = await fetch(signedData.signedUrl);
          if (!audioResponse.ok) {
            questionResults.push({ question_id: q.id, question_text: q.text, transcription: "", score: 0, error: "Audio download failed" });
            continue;
          }
          audioBlob = await audioResponse.blob();
        }
      } catch (e) {
        console.error("Audio fetch error:", e);
        questionResults.push({ question_id: q.id, question_text: q.text, transcription: "", score: 0, error: "Audio fetch error" });
        continue;
      }

      // 1. Transcribe via Whisper
      let transcription = "";
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "response.webm");
        formData.append("model", "whisper-1");
        formData.append("language", "pt");
        formData.append("response_format", "text");

        const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
          body: formData,
        });

        if (!whisperRes.ok) {
          console.error("Whisper error:", await whisperRes.text());
          transcription = "[Erro na transcrição]";
        } else {
          transcription = (await whisperRes.text()).trim();
        }
      } catch (e) {
        console.error("Transcription error:", e);
        transcription = "[Erro na transcrição]";
      }

      // 2. Evaluate with GPT — include rubric/criteria if available
      const weight = q.weight || 1;
      const rubricSection = q.rubric
        ? `\nCRITÉRIOS DE AVALIAÇÃO (RUBRICA): ${q.rubric}`
        : "";

      const evaluationPrompt = `Você é um avaliador profissional de entrevistas corporativas.

NUNCA avalie por igualdade textual.
Avalie por entendimento semântico.

PERGUNTA: ${q.text}${rubricSection}

RESPOSTA DO CANDIDATO (transcrita da voz):
${transcription}

REGRAS DE AVALIAÇÃO:
1. O candidato NÃO precisa usar as mesmas palavras.
2. Sinônimos e explicações próprias são válidas.
3. Considere erros pequenos de transcrição de voz.
4. Avalie INTENÇÃO, não frase literal.
5. Se o conceito estiver implícito, considere correto.
6. Penalize apenas quando houver entendimento errado.
7. Se a transcrição contém uma resposta relevante e coerente, o score deve refletir isso. Nunca dê score 0 se houver conteúdo relevante.

ANÁLISE:
- O candidato demonstrou entendimento do conceito?
- A explicação faz sentido lógico?
- Existe coerência profissional?

Responda SOMENTE com JSON válido:
{
  "score": <número 0-100>,
  "nivel_entendimento": "baixo | medio | alto",
  "justificativa": "explicação curta objetiva",
  "feedback_candidato": "feedback humano profissional",
  "analysis": {
    "relevance": <0-40>,
    "clarity": <0-30>,
    "coherence": <0-30>,
    "strengths": "<pontos positivos>",
    "improvements": "<pontos a melhorar>"
  }
}`;

      let qScore = 50;
      let analysis = {};

      try {
        const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: evaluationPrompt }],
            temperature: 0.3,
            max_tokens: 400,
            response_format: { type: "json_object" },
          }),
        });

        if (gptRes.ok) {
          const gptData = await gptRes.json();
          const parsed = JSON.parse(gptData.choices[0].message.content);
          qScore = Math.min(100, Math.max(0, parsed.score || 50));
          analysis = parsed.analysis || {};
        }
      } catch (e) {
        console.error("GPT evaluation error:", e);
      }

      questionResults.push({
        question_id: q.id,
        question_text: q.text,
        transcription,
        score: qScore,
        weight,
        analysis,
      });
    }

    // 3. Calculate weighted final score
    const totalWeight = questionResults.reduce((sum, r) => sum + (r.weight || 1), 0);
    const weightedScore = Math.round(
      questionResults.reduce((sum, r) => sum + r.score * (r.weight || 1), 0) / totalWeight
    );

    // Lê flag global pipelines.auto_approve_test_if_not_exists.
    // Se OFF: nunca marca test_assignment como "aprovado" sozinho — recrutador decide.
    // Se ON: respeita score >= min_score para aprovar; abaixo disso → standby.
    const { data: autoApproveSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "pipelines")
      .eq("key", "auto_approve_test_if_not_exists")
      .maybeSingle();
    const autoApproveRaw = (autoApproveSetting as any)?.value;
    const autoApproveEnabled = autoApproveRaw === true || autoApproveRaw === "true";
    const passed = weightedScore >= minScore;

    let finalStatus: "aprovado" | "standby" | "corrigido";
    if (autoApproveEnabled) {
      finalStatus = passed ? "aprovado" : "standby";
    } else {
      finalStatus = "corrigido"; // aguarda decisão manual do recrutador
    }
    const processingTime = Date.now() - startTime;

    // 4. Update test_assignment ONLY if real assignment exists
    if (assignment && !isTriageMode) {
      await supabase
        .from("test_assignments")
        .update({
          score: weightedScore,
          status: finalStatus,
          evaluated_at: new Date().toISOString(),
          evaluator_notes: `Avaliação automática IA. Score: ${weightedScore}/100. Status: ${finalStatus}. Tempo: ${processingTime}ms`,
          response: {
            type: "voice",
            audio_urls,
            evaluation: questionResults,
            final_score: weightedScore,
          },
        })
        .eq("id", test_assignment_id);

      // 4a. Auto-aprovação por score na application (mesma regra do quiz)
      if (autoApproveEnabled && passed && assignment.application_id) {
        try {
          const { data: app } = await supabase
            .from("applications")
            .select("status")
            .eq("id", assignment.application_id)
            .maybeSingle();
          const blocked = ["aprovado", "contratado", "reprovado", "standby", "desistente"];
          if (app && !blocked.includes((app as any).status)) {
            await supabase
              .from("applications")
              .update({ status: "aprovado" })
              .eq("id", assignment.application_id);
            await supabase.from("activity_logs").insert({
              user_id: assignment.candidate_id,
              action: "auto_test_approval",
              module: "pipelines",
              details: {
                application_id: assignment.application_id,
                test_assignment_id,
                score: weightedScore,
                min_score: minScore,
                reason: "score_meets_min",
                triggered_by: "evaluate_test_voice",
              },
            });
          }
        } catch (e) {
          console.error("[evaluate-test-voice] auto-approve application failed:", e);
        }
      }

      // 4b. Emit score_event so global_score updates automatically (best-effort)
      try {
        const { data: app } = await supabase
          .from("applications")
          .select("unit_job_id, unit_jobs(job_id)")
          .eq("id", assignment.application_id)
          .maybeSingle();
        const jobId = (app as any)?.unit_jobs?.job_id ?? null;

        await supabase.rpc("insert_score_event", {
          p_candidate_id: assignment.candidate_id,
          p_event_type: "test_completed",
          p_process_stage: "test",
          p_related_job_id: jobId,
          p_score_delta: weightedScore,
          p_reason: "Teste de voz avaliado automaticamente",
          p_metadata: {
            source: "voice_test",
            attempt_id: test_assignment_id,
            application_id: assignment.application_id,
          },
        });
      } catch (scoreErr) {
        console.error("[evaluate-test-voice] insert_score_event failed:", scoreErr);
      }
    }

    // 5. Log to ai_decision_logs
    try {
      const candidateId = assignment?.candidate_id || ctx.userId;
      const { data: profile } = await supabase
        .from("profiles")
        .select("cpf")
        .eq("id", candidateId)
        .single();

      await supabase.from("ai_decision_logs").insert({
        cpf: profile?.cpf || "unknown",
        module: "voice_test_evaluation",
        decision_type: finalStatus,
        input: {
          test_assignment_id: test_assignment_id || "triage",
          questions: questions.map((q: any) => ({ id: q.id, text: q.text })),
          audio_urls,
        },
        output: {
          final_score: weightedScore,
          question_results: questionResults,
          status: finalStatus,
        },
        model_provider: "openai",
        model_version: "gpt-4o-mini + whisper-1",
        processing_time_ms: processingTime,
        actor_id: ctx.userId,
        application_id: assignment?.application_id || null,
      });
    } catch (logErr) {
      console.error("Audit log error (non-fatal):", logErr);
    }

    return new Response(
      JSON.stringify({
        score: weightedScore,
        status: finalStatus,
        results: questionResults,
        processing_time_ms: processingTime,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("evaluate-test-voice error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
