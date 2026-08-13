import { corsHeaders, createAdminClient } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { units } = await req.json();

    if (!units?.length) {
      return new Response(JSON.stringify({ diagnostics: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const unitsContext = units
      .map(
        (u: any) =>
          `Unidade: ${u.name} | Vagas: ${u.openJobs} | Candidatos: ${u.totalCandidates} | Contratados: ${u.hired} | Reprovados: ${u.rejected} | Desistentes: ${u.withdrawn} | Conversão: ${u.conversionRate}% | Reprovação: ${u.rejectionRate}% | Desistência: ${u.withdrawalRate}% | Score Médio: ${u.avgScore} | Vagas Paradas: ${u.stalledJobs} | Alertas: ${u.alerts.join(", ") || "nenhum"}`
      )
      .join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `Você é o RecrutaBot, assistente de IA do sistema de recrutamento Recruta.
Analise os dados das unidades abaixo e para cada uma gere um diagnóstico preventivo.

Retorne SOMENTE um JSON válido com a estrutura:
{
  "diagnostics": [
    {
      "unitId": "id da unidade",
      "unitName": "nome",
      "diagnosis": "diagnóstico resumido em 1-2 frases",
      "suggestions": ["sugestão 1", "sugestão 2"],
      "riskLevel": "low|medium|high"
    }
  ]
}

Critérios de risco:
- high: reprovação > 60% OU desistência > 40% OU vagas paradas > 2
- medium: reprovação > 40% OU desistência > 25% OU vagas paradas > 0
- low: demais

Foque em:
1. Detectar padrões de gargalo (excesso de reprovação, demora, desistência)
2. Sugerir revisão de pipeline quando conversão é muito baixa
3. Indicar necessidade de treinamento quando rejeição é sistêmica
4. Sugerir ajuste de perfil de cargo quando score médio é baixo
Seja objetivo e prático.`,
          },
          {
            role: "user",
            content: `Dados das unidades com gargalos:\n\n${unitsContext}`,
          },
        ],
      }),
    });

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "{}";

    // Parse JSON from response (handle markdown code blocks)
    let parsed;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { diagnostics: [] };
    }

    // Map unitId back from input data
    const diagnostics = (parsed.diagnostics || []).map((d: any, i: number) => ({
      ...d,
      unitId: d.unitId || units[i]?.id || `unknown-${i}`,
      unitName: d.unitName || units[i]?.name || "Desconhecida",
    }));

    // Audit log
    const supabase = createAdminClient();

    await supabase.from("ai_decision_logs").insert({
      cpf: "system",
      module: "monitoramento",
      decision_type: "diagnostic",
      input: { units_count: units.length },
      output: { diagnostics_count: diagnostics.length },
      model_provider: "openai",
      model_version: "gpt-4o-mini",
    });

    return new Response(JSON.stringify({ diagnostics }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
