import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuth(async (req, ctx) => {
  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { unit_job_id } = await req.json();
    if (!unit_job_id) {
      return new Response(JSON.stringify({ error: "unit_job_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startTime = Date.now();

    // 1. Fetch job info
    const { data: ujData, error: ujError } = await supabase
      .from("unit_jobs")
      .select("job_id, unit_id, salary, status, jobs:job_id(title, description), units:unit_id(name, city, state)")
      .eq("id", unit_job_id)
      .single();

    if (ujError || !ujData) {
      return new Response(JSON.stringify({ error: "unit_job not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobTitle = (ujData as any)?.jobs?.title || "vaga";
    const jobDescription = (ujData as any)?.jobs?.description || "";
    const unitName = (ujData as any)?.units?.name || "unidade";
    const unitCity = (ujData as any)?.units?.city || "";
    const unitState = (ujData as any)?.units?.state || "";

    // 2. Fetch eligible talents via match_talents RPC
    const { data: matches, error: matchError } = await supabase.rpc("match_talents", { _unit_job_id: unit_job_id });
    if (matchError) throw matchError;

    // 3. Fetch underutilized talents (active, high score, no active apps, last_interaction > 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: underutilized } = await supabase
      .from("talent_pool_entries")
      .select("candidate_id, global_score, last_interaction, profiles:candidate_id(full_name, email, city, state, opt_in_talent_pool)")
      .eq("status", "active")
      .lt("last_interaction", thirtyDaysAgo)
      .order("global_score", { ascending: false })
      .limit(30);

    // Filter underutilized: must have opt_in, no active applications
    const underutilizedFiltered: any[] = [];
    if (underutilized) {
      for (const u of underutilized) {
        const profile = u.profiles as any;
        if (!profile || profile.opt_in_talent_pool === false) continue;

        const { count } = await supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("candidate_id", u.candidate_id)
          .eq("status", "em_andamento");

        if ((count || 0) === 0) {
          underutilizedFiltered.push({
            candidate_id: u.candidate_id,
            full_name: profile.full_name,
            email: profile.email,
            city: profile.city,
            state: profile.state,
            global_score: u.global_score,
            last_interaction: u.last_interaction,
            underutilized: true,
          });
        }
      }
    }

    // 4. Merge lists (matches + underutilized, deduplicate)
    const matchIds = new Set((matches || []).map((m: any) => m.candidate_id));
    const allCandidates = [
      ...(matches || []).map((m: any) => ({ ...m, underutilized: false })),
      ...underutilizedFiltered.filter((u) => !matchIds.has(u.candidate_id)),
    ];

    if (allCandidates.length === 0) {
      return new Response(JSON.stringify({ suggestions: [], message: "Nenhum talento elegível encontrado." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Send to OpenAI for ranking + justification (read-only / consultive)
    const candidatesContext = allCandidates.map((c, i) => (
      `${i + 1}. ${c.full_name || "Sem nome"} | Score: ${c.global_score} | Cidade: ${c.city || "N/A"}, ${c.state || "N/A"} | Subutilizado: ${c.underutilized ? "Sim" : "Não"}`
    )).join("\n");

    const systemPrompt = `Você é a RecrutaBot, IA consultiva de recrutamento da Recruta.
Sua função é APENAS sugerir e justificar — você NÃO pode enviar mensagens, alterar status ou modificar dados.

Analise os candidatos abaixo para a vaga e retorne uma lista ranqueada com justificativa textual para cada um.

Critérios de priorização:
- Score global (maior = melhor)
- Proximidade geográfica com a unidade
- Candidatos subutilizados devem ser destacados
- Aderência ao cargo

Responda APENAS em JSON com o formato:
{
  "ranked_suggestions": [
    {
      "candidate_index": 1,
      "rank": 1,
      "justification": "texto explicativo"
    }
  ],
  "summary": "resumo geral da análise"
}`;

    const userPrompt = `Vaga: ${jobTitle}
Descrição: ${jobDescription}
Unidade: ${unitName} (${unitCity}, ${unitState})

Candidatos elegíveis:
${candidatesContext}`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text();
      console.error("OpenAI error:", errBody);
      throw new Error(`OpenAI API error [${openaiResponse.status}]`);
    }

    const openaiResult = await openaiResponse.json();
    const rawContent = openaiResult.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI returned empty response");
    const aiContent = JSON.parse(rawContent);

    // 6. Build final response merging AI ranking with candidate data
    const suggestions = (aiContent.ranked_suggestions || []).map((rs: any) => {
      const idx = rs.candidate_index - 1;
      const candidate = allCandidates[idx];
      if (!candidate) return null;
      return {
        candidate_id: candidate.candidate_id,
        full_name: candidate.full_name,
        score: candidate.global_score,
        city: candidate.city,
        state: candidate.state,
        rank: rs.rank,
        justification: rs.justification,
        underutilized: candidate.underutilized,
      };
    }).filter(Boolean);

    const processingTime = Date.now() - startTime;

    // 7. Log to ai_decision_logs (read-only audit)
    const { data: profileData } = await supabase
      .from("profiles")
      .select("cpf")
      .eq("id", ctx.userId)
      .single();

    await supabase.from("ai_decision_logs").insert({
      cpf: profileData?.cpf || "system",
      module: "talent_pool",
      decision_type: "talent_suggestion",
      actor_id: ctx.userId,
      input: { unit_job_id, candidates_count: allCandidates.length },
      output: { suggestions_count: suggestions.length, summary: aiContent.summary },
      model_provider: "openai",
      model_version: "gpt-4o-mini",
      processing_time_ms: processingTime,
    });

    // 8. Activity log
    await supabase.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "ai_talent_suggestions_requested",
      module: "talent_pool",
      details: {
        unit_job_id,
        suggestions_count: suggestions.length,
        processing_time_ms: processingTime,
      },
    });

    return new Response(JSON.stringify({
      suggestions,
      summary: aiContent.summary || "",
      processing_time_ms: processingTime,
      model_used: "gpt-4o-mini",
      tokens_used: openaiResult.usage?.total_tokens || 0,
      consultive_only: true,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-talent-suggestions error:", err);
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
