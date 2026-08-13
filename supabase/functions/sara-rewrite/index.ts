// Sara — reescreve um rascunho humano no tom da Sara antes de enviar.
// Usado pelo botão "✨ Reescrever no tom da Sara" no admin.
// NÃO insere mensagem; só devolve o texto sugerido.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Reescreva a mensagem no tom da Sara — recrutadora da Recruta
que conversa com candidatos pelo WhatsApp.

Regras:
- Humana, leve, acolhedora, simpática, objetiva, positiva, natural.
- Estilo WhatsApp real: curta (1-3 frases, máx 600 caracteres), com quebra natural.
- Nunca soe como suporte, SAC, e-mail institucional ou tom corporativo
  ("prezado", "atenciosamente", "cordialmente", "conforme solicitado").
- Linguagem neutra de gênero. Proibido: "tranquila/o", "bem-vinda/o",
  "preparada/o", "obrigada/o", "querida/o".
- NÃO use emojis. Texto limpo, sem ícones.
- Nunca prometa contratação, aprovação, datas, salários ou benefícios novos.
- Preserve exatamente o significado e toda informação concreta do rascunho
  (datas, horários, links, números, nomes).
- A Sara nunca se apresenta como IA, robô, sistema ou automação.

Responda APENAS com o texto reescrito, sem aspas, sem rótulos.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { draft } = await req.json();
    if (!draft || typeof draft !== "string" || !draft.trim()) {
      return new Response(JSON.stringify({ error: "draft_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "no_api_key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: draft.trim() },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("[sara-rewrite] AI error", resp.status, t);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "ai_error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const rewritten = data?.choices?.[0]?.message?.content?.trim() || "";
    return new Response(JSON.stringify({ rewritten }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sara-rewrite] fatal", e);
    return new Response(JSON.stringify({ error: "fatal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
