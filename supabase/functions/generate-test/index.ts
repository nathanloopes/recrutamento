import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_RETRIES = 3;
const MAX_PROMPT_CHARS = 1500;

serve(withAuth(async (req) => {
  try {
    const { job_title, category, prompt, question_count = 5, difficulty = "medio", subcategory = "outro" } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const difficultyMap: Record<string, string> = {
      facil: "fácil (perguntas diretas, alternativas com distinção clara)",
      medio: "médio (situações realistas, alternativas plausíveis)",
      dificil: "difícil (cenários complexos, dilemas éticos/operacionais, alternativas muito próximas)",
    };
    const diffDesc = difficultyMap[difficulty] || difficultyMap["medio"];

    const subcategoryMap: Record<string, string> = {
      operacao_loja: "Operação de Loja (caixa, atendente, repositor)",
      administrativo: "Administrativo (financeiro, RH, compras)",
      gestao: "Gestão (gerente, supervisor, coordenador)",
      comercial: "Comercial (vendas, promotor, consultor)",
      logistica: "Logística (estoquista, motorista, expedição)",
      ti: "Tecnologia (suporte, desenvolvimento)",
      outro: "Geral",
    };
    const subcatDesc = subcategoryMap[subcategory] || subcategoryMap["outro"];

    // Truncate user prompt
    const safePrompt = prompt && prompt.trim() ? prompt.trim().slice(0, MAX_PROMPT_CHARS) : "";

    // ========== LAYER 1: SYSTEM RULES (compact) ==========
    const systemPrompt = `Você é um gerador de testes corporativos de RH. REGRAS OBRIGATÓRIAS:
1. Cada questão deve ser ESTUDO DE CASO: cenário concreto com nomes fictícios, local e problema, seguido da pergunta.
2. Tipos permitidos: multiple_choice, true_false, essay. NÃO use scenario nem scale.
3. multiple_choice: 4 opções com "text" e "correct" (exatamente 1 correct:true).
4. true_false: 2 opções [{"text":"Verdadeiro","correct":bool},{"text":"Falso","correct":bool}].
5. essay: inclua "rubric". NÃO inclua options.
6. Cada questão DEVE ter correct_answer_explanation e difficulty:"${difficulty}".
7. Priorize multiple_choice. Distribua tipos equilibradamente.
8. Gere EXATAMENTE ${question_count} perguntas. Nem mais, nem menos.
Retorne usando a tool fornecida.`;

    // ========== BUILD MESSAGES ==========
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    // LAYER 2: USER DIRECTIVE (priority)
    if (safePrompt) {
      messages.push({
        role: "user",
        content: `INSTRUÇÕES OBRIGATÓRIAS DO CRIADOR DO TESTE:\n\n${safePrompt}\n\nAplique estas instruções a TODAS as ${question_count} questões.`,
      });
    }

    // LAYER 3: CONTEXT + HARD CONSTRAINTS
    messages.push({
      role: "user",
      content: `DADOS DA VAGA: Cargo "${job_title}", Categoria "${category}", Perfil "${subcatDesc}", Dificuldade ${diffDesc}.
RESTRIÇÃO FINAL: Gere EXATAMENTE ${question_count} perguntas com weight, difficulty:"${difficulty}" e correct_answer_explanation.`,
    });

    // Dynamic max_tokens: ~600 tokens per question, min 8192
    const maxTokens = Math.max(8192, Math.min(question_count * 600, 16384));

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "create_test",
        description: "Create a structured test with questions",
        parameters: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["multiple_choice", "true_false", "essay"] },
                  text: { type: "string" },
                  context: { type: "string" },
                  options: { type: "array", items: { type: "object", properties: { text: { type: "string" }, correct: { type: "boolean" } }, required: ["text", "correct"] } },
                  weight: { type: "number" },
                  rubric: { type: "string" },
                  difficulty: { type: "string", enum: ["facil", "medio", "dificil"] },
                  correct_answer_explanation: { type: "string" },
                },
                required: ["type", "text", "weight", "difficulty", "correct_answer_explanation"],
              },
            },
            passing_score: { type: "number" },
          },
          required: ["questions", "passing_score"],
        },
      },
    };

    // ========== GENERATION LOOP WITH VALIDATION ==========
    let lastResult: any = null;
    let lastCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const currentMessages = [...messages];

      // On retry, add correction
      if (attempt > 1 && lastCount > 0) {
        currentMessages.push({
          role: "user",
          content: `ERRO: Você gerou ${lastCount} perguntas, mas preciso de EXATAMENTE ${question_count}. Regenere TODAS as ${question_count} perguntas.`,
        });
      }

      let response: Response;
      try {
        response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: maxTokens,
            messages: currentMessages,
            tools: [toolSchema],
            tool_choice: { type: "function", function: { name: "create_test" } },
          }),
        });
      } catch (fetchErr) {
        console.error(`[generate-test] Fetch error attempt ${attempt}:`, fetchErr);
        continue;
      }

      if (!response.ok) {
        const t = await response.text();
        console.error(`[generate-test] OpenAI error attempt ${attempt}:`, response.status, t);
        continue;
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      // Detect truncation
      if (choice?.finish_reason === "length") {
        console.warn(`[generate-test] Attempt ${attempt}: truncated (finish_reason=length). Retrying...`);
        continue;
      }

      const toolCall = choice?.message?.tool_calls?.[0];
      if (!toolCall) {
        console.error(`[generate-test] Attempt ${attempt}: no tool call in response`);
        continue;
      }

      // Safe JSON parse
      let result: any;
      try {
        result = JSON.parse(toolCall.function.arguments || '{}');
      } catch (parseErr) {
        console.error(`[generate-test] Attempt ${attempt}: JSON parse failed:`, parseErr);
        continue;
      }

      const questions = result?.questions;
      if (!Array.isArray(questions)) {
        console.error(`[generate-test] Attempt ${attempt}: questions is not an array`);
        continue;
      }

      lastResult = result;
      lastCount = questions.length;

      // Exact match — success
      if (questions.length === question_count) {
        console.log(`[generate-test] Success on attempt ${attempt}: ${questions.length}/${question_count}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Last attempt: accept >=80%
      if (attempt === MAX_RETRIES && questions.length >= Math.ceil(question_count * 0.8)) {
        console.warn(`[generate-test] Accepting partial on attempt ${attempt}: ${questions.length}/${question_count} (>=80%)`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.warn(`[generate-test] Attempt ${attempt}: received ${questions.length}, expected ${question_count}. Retrying...`);
    }

    // All retries exhausted
    console.error(`[generate-test] All ${MAX_RETRIES} attempts failed. Last count: ${lastCount}, expected: ${question_count}`);

    // Return partial if we have any valid result
    if (lastResult && Array.isArray(lastResult.questions) && lastResult.questions.length > 0) {
      return new Response(JSON.stringify(lastResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      error: `Não foi possível gerar o teste com ${question_count} perguntas após ${MAX_RETRIES} tentativas. Tente novamente.`,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-test error:", e);
    return new Response(JSON.stringify({ error: "Ocorreu um erro. Tente novamente." }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
