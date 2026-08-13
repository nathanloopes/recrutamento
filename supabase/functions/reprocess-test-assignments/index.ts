import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 5;

serve(withAuth(async (req, ctx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const assignmentIds: string[] | undefined = body.assignment_ids;

    // Find affected assignments
    let query = ctx.admin
      .from("test_assignments")
      .select("id, response, score, status, test_template_id, candidate_id")
      .not("response", "is", null);

    if (assignmentIds && assignmentIds.length > 0) {
      query = query.in("id", assignmentIds);
    } else {
      // Find all with score=0 or null that have responses
      query = query.or("score.eq.0,score.is.null");
    }

    const { data: assignments, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!assignments || assignments.length === 0) {
      return new Response(JSON.stringify({ message: "No assignments to reprocess", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[reprocess] Found ${assignments.length} assignments to reprocess`);

    // Collect all template IDs
    const templateIds = [...new Set(assignments.map((a: any) => a.test_template_id).filter(Boolean))];
    const { data: templates } = await ctx.admin
      .from("test_templates")
      .select("id, content, type")
      .in("id", templateIds);

    const templateMap: Record<string, any> = {};
    (templates || []).forEach((t: any) => { templateMap[t.id] = t; });

    // AI API config
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
      throw new Error("No AI API key configured");
    }

    const results: any[] = [];

    // Process in batches
    for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
      const batch = assignments.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (assignment: any) => {
          const template = templateMap[assignment.test_template_id];
          if (!template || !template.content?.questions) {
            return { id: assignment.id, error: "No template or questions found", skipped: true };
          }

          const questions = template.content.questions as any[];
          const answers = assignment.response?.answers || {};

          // Separate quiz vs essay
          const quizQuestions: { idx: number; q: any }[] = [];
          const essayQuestions: { idx: number; q: any }[] = [];

          questions.forEach((q: any, idx: number) => {
            const hasOptions = Array.isArray(q.options) && q.options.length > 0;
            const isEssayType = q.type === "essay" || q.type === "scenario";
            const answerValue = answers[idx];
            const isTextAnswer = typeof answerValue === "string" && answerValue.length > 0;

            if (isEssayType || (isTextAnswer && !hasOptions)) {
              essayQuestions.push({ idx, q });
            } else if (hasOptions) {
              quizQuestions.push({ idx, q });
            }
          });

          // Grade quiz questions
          let quizCorrect = 0;
          quizQuestions.forEach(({ idx, q }) => {
            const selectedIdx = answers[idx] != null ? parseInt(String(answers[idx])) : -1;
            if (selectedIdx < 0 || !Array.isArray(q.options)) return;
            
            // Check option.correct === true (AI-generated format)
            const selectedOption = q.options[selectedIdx];
            if (selectedOption && typeof selectedOption === "object" && selectedOption.correct === true) {
              quizCorrect++;
            }
            // Also check q.correct (legacy index format)
            else if (q.correct !== undefined && selectedIdx === q.correct) {
              quizCorrect++;
            }
          });

          const quizScore = quizQuestions.length > 0 ? (quizCorrect / quizQuestions.length) * 100 : 0;

          // Grade essay questions via AI
          let essayScore = 0;
          let aiGradingResults: any[] = [];

          if (essayQuestions.length > 0) {
            const essayPayload = essayQuestions.map(({ idx, q }) => ({
              question: q.question || q.text || `Pergunta ${idx + 1}`,
              candidate_answer: String(answers[idx] || ""),
              rubric: q.rubric || q.expected_answer || "",
              max_score: 100,
              context: q.context || undefined,
            }));

            // Grade via AI API directly (not calling edge function to avoid auth issues)
            for (const eq of essayPayload) {
              try {
                const systemPrompt = `Você é um avaliador de RH especializado. Avalie a resposta do candidato de forma justa e objetiva. Use a rubrica fornecida como critério. Retorne a avaliação usando a tool fornecida. Responda em português brasileiro. IMPORTANTE: Avalie o CONTEÚDO e o SENTIDO da resposta, não a correspondência literal de palavras.`;
                const userPrompt = `Pergunta: ${eq.question}\n${eq.context ? `Contexto: ${eq.context}` : ""}\nRubrica: ${eq.rubric || "Avaliar clareza, coerência, relevância e profundidade."}\nResposta do candidato: ${eq.candidate_answer}\nNota máxima: 100`;

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
                            score: { type: "number", description: "Score from 0 to 100" },
                            justification: { type: "string", description: "Justification in Portuguese" },
                            strengths: { type: "array", items: { type: "string" } },
                            weaknesses: { type: "array", items: { type: "string" } },
                          },
                          required: ["score", "justification", "strengths", "weaknesses"],
                        },
                      },
                    }],
                    tool_choice: { type: "function", function: { name: "grade_answer" } },
                  }),
                });

                if (response.ok) {
                  const data = await response.json();
                  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
                  if (toolCall) {
                    const grading = JSON.parse(toolCall.function.arguments || "{}");
                    aiGradingResults.push({ question: eq.question, ...grading });
                  } else {
                    aiGradingResults.push({ question: eq.question, error: "No tool call" });
                  }
                } else {
                  aiGradingResults.push({ question: eq.question, error: `API ${response.status}` });
                }
              } catch (err) {
                aiGradingResults.push({ question: eq.question, error: String(err) });
              }
            }

            const validScores = aiGradingResults.filter((r: any) => !r.error && r.score != null);
            essayScore = validScores.length > 0
              ? validScores.reduce((s: number, r: any) => s + (r.score || 0), 0) / validScores.length
              : 0;
          }

          // Combine scores
          const totalQuestions = quizQuestions.length + essayQuestions.length;
          const quizWeight = totalQuestions > 0 ? quizQuestions.length / totalQuestions : 0;
          const essayWeight = totalQuestions > 0 ? essayQuestions.length / totalQuestions : 0;
          const finalScore = Math.round(quizScore * quizWeight + essayScore * essayWeight);

          // Update assignment
          const updatedResponse = {
            ...assignment.response,
            ai_grading: aiGradingResults.length > 0
              ? aiGradingResults.map((r: any, ri: number) => ({
                  questionIndex: essayQuestions[ri]?.idx,
                  ...r,
                }))
              : undefined,
            reprocessed_at: new Date().toISOString(),
          };

          const { error: updateError } = await ctx.admin
            .from("test_assignments")
            .update({
              score: finalScore,
              status: "corrigido",
              response: updatedResponse,
              evaluated_at: new Date().toISOString(),
            })
            .eq("id", assignment.id);

          if (updateError) {
            return { id: assignment.id, error: updateError.message };
          }

          console.log(`[reprocess] Assignment ${assignment.id}: quiz=${Math.round(quizScore)} essay=${Math.round(essayScore)} final=${finalScore}`);
          return {
            id: assignment.id,
            previous_score: assignment.score,
            new_score: finalScore,
            quiz_score: Math.round(quizScore),
            essay_score: Math.round(essayScore),
            quiz_count: quizQuestions.length,
            essay_count: essayQuestions.length,
          };
        })
      );

      for (const r of batchResults) {
        results.push(r.status === "fulfilled" ? r.value : { error: String((r as any).reason) });
      }
    }

    const successful = results.filter(r => r && !r.error && !r.skipped);
    const failed = results.filter(r => r && (r.error || r.skipped));

    return new Response(JSON.stringify({
      processed: successful.length,
      failed: failed.length,
      total: assignments.length,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[reprocess] Error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
