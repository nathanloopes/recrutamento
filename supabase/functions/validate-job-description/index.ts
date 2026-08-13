import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if AI validation is enabled
    const { data: flagSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "jobs")
      .eq("key", "ai_job_validation_enabled")
      .maybeSingle();

    if (!flagSetting || flagSetting.value === false || flagSetting.value === "false") {
      return new Response(JSON.stringify({ enabled: false, message: "Validação IA desabilitada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { title, description } = await req.json();

    if (!title) {
      return new Response(JSON.stringify({ error: "Título obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY não configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um especialista em RH institucional da rede de franquias Recruta.
Avalie a descrição de um cargo e retorne um JSON com:
- "score": nota de 0 a 100 para qualidade da descrição
- "issues": array de problemas encontrados (strings curtas)
- "suggestions": array de sugestões de melhoria (strings curtas)
- "verdict": "aprovado" se score >= 70, "revisar" se < 70

Critérios: clareza, completude (requisitos, responsabilidades, formação, carga horária), linguagem inclusiva, coerência com cargo institucional de franquia.
Se a descrição estiver vazia ou muito curta, sugira o que incluir.
Responda APENAS com JSON válido, sem markdown.`;

    const userPrompt = `Cargo: ${title}\nDescrição: ${description || "(vazia)"}`;

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("OpenAI error:", errorText);
      return new Response(JSON.stringify({ error: "Erro ao consultar IA" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { score: 0, issues: ["Resposta IA inválida"], suggestions: [], verdict: "revisar" };
    }

    // Log the AI decision
    await supabase.from("ai_decision_logs").insert({
      cpf: "system",
      module: "cargos",
      decision_type: "validacao_descricao",
      input: { title, description },
      output: parsed,
      actor_id: user.id,
      model_provider: "openai",
      model_version: "gpt-4o-mini",
    } as any);

    return new Response(JSON.stringify({ enabled: true, ...parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("validate-job-description error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
