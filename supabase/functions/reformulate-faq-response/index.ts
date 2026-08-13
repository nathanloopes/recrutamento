import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(withAuth(async (req) => {
  try {
    const { question, draft_response } = await req.json();

    if (!question || !draft_response) {
      return new Response(
        JSON.stringify({ error: "question and draft_response are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      console.error("[reformulate-faq-response] OPENAI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "OpenAI não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente de comunicação institucional de uma empresa de recrutamento e seleção. Sua tarefa é reformular respostas para candidatos de forma clara, profissional e empática, mantendo o conteúdo original. Não adicione informações que não estejam no rascunho. Use linguagem neutra de gênero (evite 'tranquila/o', 'bem-vinda/o', 'preparada/o', 'obrigada/o'). Retorne apenas o texto reformulado, sem explicações adicionais.",
          },
          {
            role: "user",
            content: `Pergunta/contexto: "${question}"\n\nRascunho a reformular: "${draft_response}"\n\nReformule o rascunho acima para que fique claro, profissional e empático.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[reformulate-faq-response] OpenAI error:", response.status, text);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: "OPENAI_API_KEY inválida." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Erro ao chamar o serviço de IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const reformulated = data?.choices?.[0]?.message?.content?.trim() ?? "";

    return new Response(
      JSON.stringify({ reformulated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[reformulate-faq-response] fatal:", e);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
