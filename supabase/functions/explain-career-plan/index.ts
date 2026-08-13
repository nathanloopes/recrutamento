import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { mode, career_plan, unit_jobs } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let systemPrompt = "";
    let userPrompt = "";

    if (mode === "explain") {
      // Explain a career plan in simple language
      systemPrompt = `Você é um assistente de RH da rede Recruta. Explique planos de carreira de forma clara e acessível para candidatos. Use linguagem simples, sem jargões. Seja objetivo e motivador, mas NUNCA prometa progressão garantida. Responda em português brasileiro.`;
      const levels = career_plan?.levels || [];
      userPrompt = `Explique este plano de carreira para um candidato:\n\nNíveis:\n${levels.map((l: any, i: number) => `${i + 1}. ${l.name} — Faixa salarial: ${l.salary_range || "não informada"} — Critérios: ${l.criteria || "não informados"}`).join("\n")}\n\nExplique de forma clara o que cada nível significa, como progredir, e o que o candidato pode esperar. Seja honesto sobre os critérios.`;
    } else if (mode === "compare") {
      // Compare units by salary and benefits
      systemPrompt = `Você é um assistente de RH da rede Recruta. Compare vagas de diferentes unidades de forma objetiva e imparcial. NÃO embeleze dados. NÃO crie expectativas falsas. Apenas apresente os fatos de forma clara para ajudar o candidato a tomar uma decisão consciente. Responda em português brasileiro.`;
      const ujList = (unit_jobs || []).map((uj: any) => {
        const benefits = Array.isArray(uj.benefits) ? uj.benefits.join(", ") : "não informados";
        return `- ${uj.unit_name} (${uj.city}/${uj.state}): Salário R$ ${uj.salary || "não informado"}, Benefícios: ${benefits}, Plano de carreira: ${uj.has_career_plan ? "Sim" : "Não"}`;
      }).join("\n");
      userPrompt = `Compare estas vagas para o candidato:\n\n${ujList}\n\nApresente as diferenças relevantes de forma objetiva. Destaque pontos fortes e fracos de cada opção.`;
    } else {
      return new Response(JSON.stringify({ error: "Mode must be 'explain' or 'compare'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ explanation: content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("explain-career-plan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
