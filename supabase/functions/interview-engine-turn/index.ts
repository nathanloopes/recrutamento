import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";
import { guardFeatureFlag } from "../_shared/feature-flag-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * interview-engine-turn
 *
 * Unified edge function for the Interview Engine state machine.
 *
 * Actions:
 *  - generate_question: Generate the next interview question based on stage/context
 *  - evaluate_answer:   Transcribe audio + evaluate answer + return scores
 *  - evaluate_text:     Evaluate a text answer (fallback for voice)
 *  - closing:           Generate a closing message based on results
 *
 * Input:
 *  - action: string
 *  - context: { turns, memory, currentStage, objective, jobTitle, jobDescription, questionIndexInStage }
 *  - audio_url?: string (for evaluate_answer)
 *  - answer_text?: string (for evaluate_text)
 *  - result?: object (for closing)
 *
 * Output:
 *  - question?: string
 *  - transcription?: string
 *  - scores?: DimensionScores
 *  - overallScore?: number
 *  - strengths?: string[]
 *  - weaknesses?: string[]
 *  - memoryUpdate?: Partial<ContextMemory>
 *  - closingMessage?: string
 *  - anticipatedNext?: string
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

    const body = await req.json();
    const { action, context, audio_url, answer_text, result } = body;

    if (!action || !context) {
      return jsonResponse({ error: "action and context are required" }, 400);
    }

    // Load AI settings
    const { data: aiSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .in("category", ["ai", "ai_governance", "voice"]);

    const cfg: Record<string, string> = {};
    (aiSettings || []).forEach((s: any) => { cfg[s.key] = s.value; });

    const model = cfg.ai_model_default || "gpt-4o-mini";
    const voiceWeight = Number(cfg.voice_weight ?? 25);
    const allowRepeatVoice = cfg.allow_repeat_voice !== "false";
    const allowHumanEscalation = cfg.allow_human_escalation !== "false";
    const minVoiceScore = Number(cfg.min_voice_score ?? 60);

    switch (action) {
      case "generate_question":
        return await handleGenerateQuestion(OPENAI_API_KEY, model, context, supabase, ctx.userId);

      case "evaluate_answer":
        return await handleEvaluateAnswer(OPENAI_API_KEY, model, context, audio_url, supabase, ctx.userId);

      case "evaluate_text":
        return await handleEvaluateText(OPENAI_API_KEY, model, context, answer_text, supabase, ctx.userId);

      case "closing":
        return await handleClosing(OPENAI_API_KEY, model, context, result, supabase, ctx.userId);

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("interview-engine-turn error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
}));

// ─── Action Handlers ────────────────────────────────────────────────────────────

async function loadUnitTone(supabase: any, userId: string): Promise<{ tone: string; language: string }> {
  try {
    // Find the candidate's active application → unit → unit_policies
    const { data: app } = await supabase
      .from("applications")
      .select("unit_job_id, unit_jobs(unit_id)")
      .eq("candidate_id", userId)
      .eq("status", "em_andamento")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const unitId = app?.unit_jobs?.unit_id;
    if (!unitId) return { tone: "formal", language: "pt-BR" };

    const { data: policy } = await supabase
      .from("unit_policies")
      .select("tone, language")
      .eq("unit_id", unitId)
      .maybeSingle();

    return {
      tone: policy?.tone || "formal",
      language: policy?.language || "pt-BR",
    };
  } catch {
    return { tone: "formal", language: "pt-BR" };
  }
}

async function handleGenerateQuestion(
  apiKey: string,
  model: string,
  context: any,
  supabase: any,
  userId: string
) {
  const { turns, memory, currentStage, objective, jobTitle, jobDescription, questionIndexInStage, guideBlocks } = context;

  // Load institutional tone from unit_policies
  const unitTone = await loadUnitTone(supabase, userId);

  const previousContext = turns.length > 0
    ? turns.map((t: any, i: number) =>
        `[${t.stage}] Pergunta: ${t.aiQuestion}\nResposta: ${t.candidateAnswer}\nScore: ${t.overallScore}/100`
      ).join("\n\n")
    : "Nenhuma interação anterior.";

  const memoryContext = memory.detectedStrengths.length > 0 || memory.detectedWeaknesses.length > 0
    ? `\nFORÇAS DETECTADAS: ${memory.detectedStrengths.join(", ") || "nenhuma ainda"}\nFRAQUEZAS DETECTADAS: ${memory.detectedWeaknesses.join(", ") || "nenhuma ainda"}\nCONTRADIÇÕES: ${memory.contradictions?.join(", ") || "nenhuma"}\nTÓPICOS-CHAVE: ${memory.keyTopics?.join(", ") || "nenhum"}`
    : "";

  // Build guide context if available
  let guideContext = "";
  if (guideBlocks && guideBlocks.length > 0) {
    const allQuestions = guideBlocks.flatMap((block: any) =>
      (block.questions || []).map((q: any) => `[${block.name}] ${q.text}${q.required ? " (obrigatória)" : ""}`)
    );
    const askedQuestions = turns.map((t: any) => t.aiQuestion);
    const remainingQuestions = allQuestions.filter((q: string) =>
      !askedQuestions.some((asked: string) => asked.includes(q.slice(q.indexOf("]") + 2)))
    );
    guideContext = `\n\nROTEIRO APROVADO PARA ESTE CARGO:
${remainingQuestions.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n")}

REGRA FUNDAMENTAL: Use OBRIGATORIAMENTE as perguntas do roteiro acima como base. Você pode adaptar a linguagem para soar natural na conversa, mas o conteúdo da pergunta deve seguir o roteiro. NÃO invente perguntas fora do roteiro.`;
  }

  const prompt = `Você é uma recrutadora profissional da rede Recruta conduzindo uma entrevista real para o cargo de "${jobTitle}".
${jobDescription ? `Descrição do cargo: ${jobDescription}` : ""}
${guideContext}

ESTÁGIO ATUAL: ${currentStage}
OBJETIVO DO ESTÁGIO: ${objective?.goal || "Avaliar o candidato"}
PERGUNTA ${questionIndexInStage + 1} de ${objective?.questionCount || 1} neste estágio.
DIMENSÕES FOCO: ${objective?.focusDimensions?.join(", ") || "geral"}

CONTEXTO ANTERIOR:
${previousContext}
${memoryContext}

TOM INSTITUCIONAL: ${unitTone.tone} (${unitTone.language})

REGRAS OBRIGATÓRIAS:
1. Fale como uma recrutadora HUMANA — tom ${unitTone.tone}, calmo, objetivo
2. NUNCA pareça robótica ou chatbot
3. Frases curtas e diretas (máximo 3 frases por vez)
4. Se houver respostas anteriores, REFERENCIE algo que o candidato disse
5. Não repita perguntas já feitas
6. A pergunta deve servir ao objetivo do estágio
7. Responda no idioma ${unitTone.language === "pt-BR" ? "Português (Brasil)" : unitTone.language === "es" ? "Español" : "English"}
8. ${currentStage === "INTRODUCTION" ? "Apresente-se como Ana, recrutadora, e peça que o candidato se apresente" : "Faça uma transição natural da resposta anterior para a próxima pergunta"}

Responda SOMENTE com JSON:
{
  "question": "<sua pergunta/fala — máximo 3 frases>",
  "anticipatedNext": "<uma possível próxima pergunta para pré-carregar TTS>"
}`;

  const gptRes = await callGPT(apiKey, model, prompt, 300);
  const parsed = parseJSON(gptRes);

  await logDecision(supabase, userId, "generate_question", {
    stage: currentStage,
    questionIndex: questionIndexInStage,
  }, parsed);

  return jsonResponse({
    question: parsed.question || "Pode me contar mais sobre sua experiência?",
    anticipatedNext: parsed.anticipatedNext || null,
  });
}

async function handleEvaluateAnswer(
  apiKey: string,
  model: string,
  context: any,
  audioUrl: string,
  supabase: any,
  userId: string
) {
  if (!audioUrl) return jsonResponse({ error: "audio_url required" }, 400);

  // 1. Transcribe via Whisper
  let transcription = "";
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error("Failed to fetch audio");
    const audioBlob = await audioRes.blob();

    const formData = new FormData();
    formData.append("file", audioBlob, "response.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "pt");
    formData.append("response_format", "text");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (whisperRes.ok) {
      transcription = (await whisperRes.text()).trim();
    } else {
      transcription = "[Erro na transcrição]";
    }
  } catch {
    transcription = "[Erro na transcrição]";
  }

  // 2. Evaluate
  const evalResult = await evaluateAnswer(apiKey, model, context, transcription);

  await logDecision(supabase, userId, "evaluate_answer", {
    stage: context.currentStage,
    transcription,
    audioUrl,
  }, evalResult);

  // 3. Persist transcript + scores into audit tables
  const voiceInterviewId = context.voiceInterviewId;
  if (voiceInterviewId) {
    try {
      // Extract audio storage path from URL
      const audioPath = audioUrl.includes("/voice-recordings/")
        ? audioUrl.split("/voice-recordings/")[1]?.split("?")[0] || null
        : null;

      const questionIndex = context.turns?.length ?? 0;
      const questionText = context.turns?.length > 0
        ? context.turns[context.turns.length - 1]?.aiQuestion || "N/A"
        : "Apresentação inicial";

      // Insert transcript
      const { data: transcriptRow } = await supabase
        .from("voice_interview_transcripts")
        .insert({
          voice_interview_id: voiceInterviewId,
          question_index: questionIndex,
          question_text: questionText,
          audio_storage_path: audioPath,
          transcription,
          duration_seconds: null,
        })
        .select("id")
        .single();

      const transcriptId = transcriptRow?.id || null;

      // Insert dimension scores
      if (evalResult.scores) {
        const scoreRows = Object.entries(evalResult.scores).map(([dimension, score]) => ({
          voice_interview_id: voiceInterviewId,
          transcript_id: transcriptId,
          dimension,
          score: score as number,
          justification: null,
          model_used: model,
        }));
        await supabase.from("voice_interview_scores").insert(scoreRows);
      }
    } catch (auditErr) {
      console.error("Audit table insert error (non-fatal):", auditErr);
    }
  }

  return jsonResponse({
    transcription,
    ...evalResult,
  });
}

async function handleEvaluateText(
  apiKey: string,
  model: string,
  context: any,
  answerText: string,
  supabase: any,
  userId: string
) {
  if (!answerText) return jsonResponse({ error: "answer_text required" }, 400);

  const evalResult = await evaluateAnswer(apiKey, model, context, answerText);

  await logDecision(supabase, userId, "evaluate_text", {
    stage: context.currentStage,
    answerText,
  }, evalResult);

  // Persist transcript + scores into audit tables
  const voiceInterviewId = context.voiceInterviewId;
  if (voiceInterviewId) {
    try {
      const questionIndex = context.turns?.length ?? 0;
      const questionText = context.turns?.length > 0
        ? context.turns[context.turns.length - 1]?.aiQuestion || "N/A"
        : "Apresentação inicial";

      const { data: transcriptRow } = await supabase
        .from("voice_interview_transcripts")
        .insert({
          voice_interview_id: voiceInterviewId,
          question_index: questionIndex,
          question_text: questionText,
          audio_storage_path: null,
          transcription: answerText,
          duration_seconds: null,
        })
        .select("id")
        .single();

      const transcriptId = transcriptRow?.id || null;

      if (evalResult.scores) {
        const scoreRows = Object.entries(evalResult.scores).map(([dimension, score]) => ({
          voice_interview_id: voiceInterviewId,
          transcript_id: transcriptId,
          dimension,
          score: score as number,
          justification: null,
          model_used: model,
        }));
        await supabase.from("voice_interview_scores").insert(scoreRows);
      }
    } catch (auditErr) {
      console.error("Audit table insert error (non-fatal):", auditErr);
    }
  }

  return jsonResponse({
    transcription: answerText,
    ...evalResult,
  });
}

async function handleClosing(
  apiKey: string,
  model: string,
  context: any,
  result: any,
  supabase: any,
  userId: string
) {
  const { turns, memory, jobTitle } = context;
  let decision = result?.decision || "TALENT_POOL";
  const finalScore = result?.finalScore || 50;

  // Load institutional tone
  const unitTone = await loadUnitTone(supabase, userId);

  // Load escalation governance settings
  let escalationMargin = 0;
  let escalationOnInconsistency = false;
  try {
    const { data: govRows } = await supabase
      .from("global_settings")
      .select("key, value")
      .in("key", ["escalation_score_margin", "escalation_on_inconsistency"]);
    const gov: Record<string, any> = {};
    (govRows || []).forEach((r: any) => { gov[r.key] = r.value; });
    escalationMargin = Number(gov.escalation_score_margin ?? 0);
    escalationOnInconsistency = gov.escalation_on_inconsistency === true || gov.escalation_on_inconsistency === "true";
  } catch {}

  // Apply escalation rules server-side
  if (escalationMargin > 0 && decision !== "ESCALATED") {
    const approveThreshold = 75;
    const talentPoolThreshold = 50;
    const nearApprove = finalScore < approveThreshold && Math.abs(finalScore - approveThreshold) <= escalationMargin;
    const nearReject = finalScore > talentPoolThreshold && Math.abs(finalScore - talentPoolThreshold) <= escalationMargin;
    if (nearApprove || nearReject) {
      decision = "ESCALATED";
    }
  }

  if (escalationOnInconsistency && decision !== "ESCALATED" && result?.dimensionAverages) {
    const dimValues = Object.values(result.dimensionAverages).filter((v: any) => typeof v === "number") as number[];
    if (dimValues.length > 0) {
      const spread = Math.max(...dimValues) - Math.min(...dimValues);
      if (spread > 30) {
        decision = "ESCALATED";
      }
    }
  }

  const toneInstruction = unitTone.tone === "acolhedor" ? "caloroso e acolhedor" : unitTone.tone === "neutro" ? "neutro e objetivo" : "profissional e formal";

  const prompt = `Você é Ana, recrutadora profissional da rede Recruta.
A entrevista para "${jobTitle}" acabou.
TOM INSTITUCIONAL: ${toneInstruction} (idioma: ${unitTone.language})

RESULTADO: ${decision} (Score: ${finalScore}/100)
FORÇAS: ${memory.detectedStrengths?.join(", ") || "não identificadas"}
PONTOS A MELHORAR: ${memory.detectedWeaknesses?.join(", ") || "não identificados"}
TOTAL DE PERGUNTAS: ${turns.length}

Gere uma mensagem de encerramento:
- Máximo 4 frases
- Tom profissional e empático
- ${decision === "APPROVED"
    ? "Parabenize e informe que será encaminhado para próxima etapa"
    : decision === "TALENT_POOL"
    ? "Agradeça e informe que o perfil ficará no banco de talentos"
    : decision === "ESCALATED"
    ? "Agradeça e informe que um recrutador humano fará a análise final do perfil"
    : "Agradeça com empatia e informe que poderá tentar novamente"}
- NUNCA mencione scores numéricos ao candidato

Responda SOMENTE com JSON:
{
  "closingMessage": "<sua mensagem de encerramento>"
}`;

  const gptRes = await callGPT(apiKey, model, prompt, 200);
  const parsed = parseJSON(gptRes);

  await logDecision(supabase, userId, "closing", { decision, finalScore }, parsed);

  // Dispatch interview completion notification
  try {
    const eventType = decision === "APPROVED" ? "interview_approved" 
      : decision === "TALENT_POOL" ? "interview_talent_pool" 
      : decision === "ESCALATED" ? "interview_escalated"
      : "interview_completed";

    await supabase.from("notifications").insert({
      event_type: eventType,
      recipient_id: userId,
      channel: "push",
      title: "Entrevista Finalizada",
      body: decision === "APPROVED" 
        ? "Parabéns! Você foi aprovado na entrevista e será encaminhado para a próxima etapa."
        : decision === "TALENT_POOL"
        ? "Sua entrevista foi concluída. Seu perfil foi adicionado ao banco de talentos."
        : decision === "ESCALATED"
        ? "Sua entrevista foi concluída. Um recrutador humano fará a análise final do seu perfil."
        : "Sua entrevista foi concluída. Agradecemos sua participação.",
      status: "pending",
      payload: { decision, finalScore, action: "interview_complete" },
      action_url: "/candidato/minhas-candidaturas",
      action_type: "info",
    });

    // If escalated, notify admin/RH users
    if (decision === "ESCALATED") {
      try {
        const { data: admins } = await supabase
          .from("profiles")
          .select("id")
          .in("role", ["admin", "rh_franqueadora", "gestor_recrutamento"]);
        
        if (admins && admins.length > 0) {
          const adminNotifs = admins.map((a: any) => ({
            event_type: "interview_escalated_admin",
            recipient_id: a.id,
            channel: "push",
            title: "Entrevista IA Escalada",
            body: `Uma entrevista IA para "${jobTitle}" requer revisão humana. Score: ${finalScore}/100.`,
            status: "pending",
            payload: { decision, finalScore, candidateId: userId, jobTitle },
            action_url: "/admin/entrevistas-ia",
            action_type: "action",
          }));
          await supabase.from("notifications").insert(adminNotifs);
        }
      } catch (adminNotifErr) {
        console.error("Admin escalation notification error (non-fatal):", adminNotifErr);
      }
    }
  } catch (notifErr) {
    console.error("Notification dispatch error (non-fatal):", notifErr);
  }

  return jsonResponse({
    closingMessage: parsed.closingMessage || "Obrigado pela sua participação. Entraremos em contato em breve.",
  });
}

// ─── Shared Evaluation ──────────────────────────────────────────────────────────

async function evaluateAnswer(apiKey: string, model: string, context: any, answer: string) {
  const { turns, memory, currentStage, objective, jobTitle } = context;

  const previousContext = turns.length > 0
    ? turns.slice(-3).map((t: any) =>
        `Pergunta: ${t.aiQuestion}\nResposta: ${t.candidateAnswer}\nScore: ${t.overallScore}/100`
      ).join("\n\n")
    : "";

  const currentQuestion = turns.length > 0
    ? ""
    : "Primeira interação da entrevista.";

  const prompt = `Você é um avaliador profissional de entrevistas corporativas para o cargo de "${jobTitle}" na rede Recruta.

NUNCA avalie por igualdade textual.
Avalie por entendimento semântico.

ESTÁGIO: ${currentStage}
OBJETIVO: ${objective?.goal || "Avaliar o candidato"}
DIMENSÕES FOCO: ${objective?.focusDimensions?.join(", ") || "todas"}

PERGUNTA FEITA: ${context.turns?.length > 0 ? context.turns[context.turns.length - 1]?.aiQuestion || "N/A" : "Apresentação inicial"}
RESPOSTA DO CANDIDATO: ${answer}

${previousContext ? `RESPOSTAS ANTERIORES (últimas 3):\n${previousContext}` : ""}

MEMÓRIA DO CANDIDATO:
- Forças: ${memory.detectedStrengths?.join(", ") || "não identificadas"}
- Fraquezas: ${memory.detectedWeaknesses?.join(", ") || "não identificadas"}
- Contradições: ${memory.contradictions?.join(", ") || "nenhuma"}

REGRAS DE AVALIAÇÃO:
1. O candidato NÃO precisa usar as mesmas palavras.
2. Sinônimos e explicações próprias são válidas.
3. Considere erros pequenos de transcrição de voz.
4. Avalie INTENÇÃO, não frase literal.
5. Se o conceito estiver implícito, considere correto.
6. Penalize apenas quando houver entendimento errado.

AVALIE EM 6 DIMENSÕES (0-100 cada):
1. communication — clareza na comunicação verbal
2. confidence — segurança e firmeza nas respostas
3. technical_level — conhecimento técnico demonstrado
4. reasoning — capacidade de raciocínio e análise
5. clarity — objetividade e organização das ideias
6. behavioral_signals — indicadores comportamentais positivos

TAMBÉM IDENTIFIQUE:
- Novas forças detectadas nesta resposta
- Novas fraquezas detectadas
- Contradições com respostas anteriores (se houver)
- Tópicos-chave mencionados

Responda SOMENTE com JSON:
{
  "scores": {
    "communication": <0-100>,
    "confidence": <0-100>,
    "technical_level": <0-100>,
    "reasoning": <0-100>,
    "clarity": <0-100>,
    "behavioral_signals": <0-100>
  },
  "overallScore": <0-100>,
  "strengths": ["<força 1>", "<força 2>"],
  "weaknesses": ["<fraqueza 1>"],
  "memoryUpdate": {
    "contradictions": ["<contradição encontrada>"],
    "keyTopics": ["<tópico mencionado>"],
    "overallImpression": "<impressão geral atualizada em 1 frase>"
  }
}`;

  try {
    const gptRes = await callGPT(apiKey, model, prompt, 500);
    const parsed = parseJSON(gptRes);

    return {
      scores: parsed.scores || defaultScores(),
      overallScore: parsed.overallScore ?? 50,
      strengths: parsed.strengths || [],
      weaknesses: parsed.weaknesses || [],
      memoryUpdate: parsed.memoryUpdate || null,
    };
  } catch {
    return {
      scores: defaultScores(),
      overallScore: 50,
      strengths: [],
      weaknesses: [],
      memoryUpdate: null,
    };
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────────

async function callGPT(apiKey: string, model: string, prompt: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GPT error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

function parseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = str.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (match) return JSON.parse(match[1]);
    return {};
  }
}

function defaultScores() {
  return {
    communication: 50,
    confidence: 50,
    technical_level: 50,
    reasoning: 50,
    clarity: 50,
    behavioral_signals: 50,
  };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logDecision(supabase: any, userId: string, action: string, input: any, output: any) {
  try {
    // Get CPF for audit trail
    const { data: profile } = await supabase
      .from("profiles")
      .select("cpf")
      .eq("id", userId)
      .single();

    await supabase.from("ai_decision_logs").insert({
      cpf: profile?.cpf || "unknown",
      module: `interview_engine_${action}`,
      decision_type: action,
      input: input,
      output: output,
      model_provider: "openai",
      model_version: "gpt-4o-mini + whisper-1",
      actor_id: userId,
    });
  } catch {}
}
