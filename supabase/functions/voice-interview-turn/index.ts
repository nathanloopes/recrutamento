import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * voice-interview-turn
 * 
 * Recebe o áudio de uma resposta, transcreve via Whisper, avalia com GPT
 * e retorna o próximo passo (continue, repeat, end).
 * 
 * Input:
 *  - audio_url: string (URL pública do áudio no storage)
 *  - question_id: string
 *  - question_text: string
 *  - step_id: string
 *  - job_title: string
 *  - turn_index: number
 *  - total_questions: number
 *  - previous_turns: { question: string, answer: string, score: number }[]
 * 
 * Output:
 *  - transcription: string
 *  - score: number (0-100)
 *  - decision: "continue" | "repeat" | "end"
 *  - feedback: string (breve feedback para o candidato)
 *  - ai_analysis: object
 */
Deno.serve(withAuth(async (req, ctx) => {
  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      audio_url,
      question_id,
      question_text,
      step_id,
      job_title,
      turn_index,
      total_questions,
      previous_turns,
    } = await req.json();

    if (!audio_url || !question_text) {
      return new Response(
        JSON.stringify({ error: "audio_url and question_text are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load CrossConfig voice settings
    const { data: voiceSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "voice")
      .in("key", ["min_voice_score", "max_voice_retries", "max_response_time"]);

    const cfg: Record<string, any> = {};
    (voiceSettings || []).forEach((s: any) => { cfg[s.key] = s.value; });
    const minScore = Number(cfg.min_voice_score ?? 60);
    const repeatFloor = Math.floor(minScore / 2);
    const maxResponseTime = Number(cfg.max_response_time ?? 120);

    // 1. Download and transcribe audio via Whisper
    let transcription = "";
    try {
      const audioResponse = await fetch(audio_url);
      if (!audioResponse.ok) throw new Error("Failed to fetch audio");
      const audioBlob = await audioResponse.blob();

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

    // 2. Evaluate with GPT
    const previousContext = (previous_turns || [])
      .map((t: any, i: number) => `Pergunta ${i + 1}: ${t.question}\nResposta: ${t.answer}\nNota: ${t.score}/100`)
      .join("\n\n");

    const evaluationPrompt = `Você é um avaliador profissional de entrevistas corporativas para o cargo de "${job_title || "não especificado"}" na rede Recruta.

NUNCA avalie por igualdade textual.
Avalie por entendimento semântico.

PERGUNTA: ${question_text}

RESPOSTA DO CANDIDATO (transcrita da voz):
${transcription}

${previousContext ? `CONTEXTO DAS RESPOSTAS ANTERIORES:\n${previousContext}\n` : ""}

REGRAS DE AVALIAÇÃO:
1. O candidato NÃO precisa usar as mesmas palavras.
2. Sinônimos e explicações próprias são válidas.
3. Considere erros pequenos de transcrição de voz.
4. Avalie INTENÇÃO, não frase literal.
5. Se o conceito estiver implícito, considere correto.
6. Penalize apenas quando houver entendimento errado.

ANÁLISE:
- O candidato demonstrou entendimento do conceito?
- A explicação faz sentido lógico?
- Existe coerência profissional?

Tempo máximo de resposta configurado: ${maxResponseTime} segundos.

REGRAS DE DECISÃO:
- Se a nota total >= ${minScore}: decision = "continue" (segue para próxima pergunta)
- Se a nota total >= ${repeatFloor} e < ${minScore}: decision = "repeat" (pede para responder novamente com dica)
- Se a nota total < ${repeatFloor}: decision = "end" (encerra entrevista)
- Se é a última pergunta (${turn_index + 1} de ${total_questions}): decision = "end" independente da nota

Responda SOMENTE com JSON válido:
{
  "score": <número 0-100>,
  "decision": "<continue|repeat|end>",
  "feedback": "<feedback humano profissional e encorajador, máximo 2 frases>",
  "nivel_entendimento": "baixo | medio | alto",
  "justificativa": "explicação curta objetiva",
  "analysis": {
    "relevance": <0-40>,
    "clarity": <0-30>,
    "coherence": <0-30>,
    "strengths": "<pontos positivos>",
    "improvements": "<pontos a melhorar>"
  }
}`;

    let aiResult = { score: 50, decision: "continue" as string, feedback: "", analysis: {} };

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
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      });

      if (gptRes.ok) {
        const gptData = await gptRes.json();
        const parsed = JSON.parse(gptData.choices[0].message.content);
        aiResult = {
          score: Math.min(100, Math.max(0, parsed.score || 50)),
          decision: parsed.decision || "continue",
          feedback: parsed.feedback || "",
          analysis: parsed.analysis || {},
        };
      }
    } catch (e) {
      console.error("GPT evaluation error:", e);
    }

    // Force end if last question
    if (turn_index + 1 >= total_questions && aiResult.decision !== "repeat") {
      aiResult.decision = "end";
    }

    // 3. Log the turn
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("cpf")
        .eq("id", ctx.userId)
        .single();

      await supabase.from("ai_decision_logs").insert({
        cpf: profile?.cpf || "unknown",
        module: "voice_interview_turn",
        decision_type: aiResult.decision,
        input: {
          question_id,
          question_text,
          transcription,
          turn_index,
          audio_url,
        },
        output: aiResult,
        model_provider: "openai",
        model_version: "gpt-4o-mini + whisper-1",
        actor_id: ctx.userId,
      });
    } catch (logErr) {
      console.error("Audit log error (non-fatal):", logErr);
    }

    return new Response(
      JSON.stringify({
        transcription,
        score: aiResult.score,
        decision: aiResult.decision,
        feedback: aiResult.feedback,
        ai_analysis: aiResult.analysis,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("voice-interview-turn error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
