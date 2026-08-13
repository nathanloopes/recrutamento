import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { withAuth } from "../_shared/with-auth.ts";
import { guardFeatureFlag } from "../_shared/feature-flag-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(withAuth(async (req) => {
  const flagBlock = await guardFeatureFlag("automated_evaluation");
  if (flagBlock) return flagBlock;

  try {
    const { questions } = await req.json();

    // Determine which API to use: OpenAI or Lovable AI Gateway
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    let apiUrl: string;
    let apiKey: string;
    let model: string;

    if (OPENAI_API_KEY) {
      apiUrl = "https://api.openai.com/v1/chat/completions";
      apiKey = OPENAI_API_KEY;
      model = "gpt-4o-mini";
    } else if (LOVABLE_API_KEY) {
      apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
      apiKey = LOVABLE_API_KEY;
      model = "google/gemini-2.5-flash";
    } else {
      throw new Error("No AI API key configured (OPENAI_API_KEY or LOVABLE_API_KEY)");
    }

    if (!Array.isArray(questions) || questions.length === 0 || questions.length > 50) {
      return new Response(JSON.stringify({ error: "questions must be an array with 1-50 items" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const q of questions) {
      const systemPrompt = `Você é um avaliador de RH especializado. Avalie a resposta do candidato de forma justa e objetiva.
Use a rubrica fornecida como critério. Retorne a avaliação usando a tool fornecida. Responda em português brasileiro.
IMPORTANTE: Avalie o CONTEÚDO e o SENTIDO da resposta, não a correspondência literal de palavras. Se o candidato expressou a ideia correta com palavras diferentes, considere como resposta válida.`;

      const userPrompt = `Pergunta: ${q.question}
${q.context ? `Contexto do cenário: ${q.context}` : ""}
Rubrica de avaliação: ${q.rubric || "Avaliar clareza, coerência, relevância e profundidade da resposta. Uma resposta que transmite a ideia correta com palavras diferentes deve receber nota alta."}
Resposta do candidato: ${q.candidate_answer}
Nota máxima: ${q.max_score || 100}`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "grade_answer",
              description: "Grade a candidate's essay answer",
              parameters: {
                type: "object",
                properties: {
                  score: { type: "number", description: "Score from 0 to max_score" },
                  justification: { type: "string", description: "Justification for the score in Portuguese" },
                  strengths: { type: "array", items: { type: "string" }, description: "Strong points" },
                  weaknesses: { type: "array", items: { type: "string" }, description: "Points to improve" },
                },
                required: ["score", "justification", "strengths", "weaknesses"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "grade_answer" } },
        }),
      });

      if (!response.ok) {
        const t = await response.text();
        console.error("AI API error:", response.status, t);
        results.push({ question: q.question, error: "Erro ao corrigir" });
        continue;
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const grading = JSON.parse(toolCall?.function?.arguments || '{}');
        results.push({ question: q.question, ...grading });
      } else {
        results.push({ question: q.question, error: "No tool call" });
      }
    }

    const validResults = results.filter((r: any) => !r.error);
    const avgScore = validResults.length > 0
      ? validResults.reduce((s: number, r: any) => s + (r.score || 0), 0) / validResults.length
      : 0;

    return new Response(JSON.stringify({
      results,
      summary: {
        average_score: Math.round(avgScore),
        total_graded: validResults.length,
        total_questions: questions.length,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("grade-essay error:", e);
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
