import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(withAuth(async (req) => {
  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { ticket_id } = await req.json();
    if (!ticket_id) {
      return new Response(JSON.stringify({ error: "ticket_id is required" }), { status: 400, headers: corsHeaders });
    }

    // Fetch ticket
    const { data: ticket, error: ticketErr } = await adminClient
      .from("support_tickets")
      .select("*")
      .eq("id", ticket_id)
      .single();

    if (ticketErr || !ticket) {
      return new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404, headers: corsHeaders });
    }

    // Fetch existing published FAQ articles for duplicate detection
    const { data: existingArticles } = await adminClient
      .from("faq_articles")
      .select("id, question, answer, tags")
      .eq("status", "publicado")
      .order("created_at", { ascending: false })
      .limit(100);

    const articlesContext = (existingArticles || [])
      .map((a: any, i: number) => `[${i}] Pergunta: ${a.question}\nResposta: ${a.answer}`)
      .join("\n\n");

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), { status: 500, headers: corsHeaders });
    }

    const ticketContent = `Pergunta do candidato: ${ticket.question}
${ticket.ai_answer ? `Resposta da IA: ${ticket.ai_answer}` : ""}
${ticket.admin_response ? `Resposta do admin: ${ticket.admin_response}` : ""}
${ticket.context ? `Contexto adicional: ${JSON.stringify(ticket.context)}` : ""}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Você é um especialista em criar artigos de FAQ para uma plataforma de recrutamento.
Sua tarefa é transformar um chamado de suporte em um artigo de FAQ claro e objetivo.
Analise também os artigos existentes para detectar duplicatas.

Artigos existentes no FAQ:
${articlesContext || "(nenhum artigo existente)"}`,
          },
          {
            role: "user",
            content: `Transforme este chamado em um artigo de FAQ:\n\n${ticketContent}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_faq_article",
              description: "Generate a FAQ article from a support ticket, detecting duplicates.",
              parameters: {
                type: "object",
                properties: {
                  suggested_question: {
                    type: "string",
                    description: "Clear, general FAQ question in Portuguese.",
                  },
                  suggested_answer: {
                    type: "string",
                    description: "Clear, helpful FAQ answer in Portuguese.",
                  },
                  suggested_tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Suggested tags from: recrutamento, geral, entrevista, documentação, onboarding.",
                  },
                  is_duplicate: {
                    type: "boolean",
                    description: "True if an existing article already covers this topic.",
                  },
                  similar_article_indices: {
                    type: "array",
                    items: { type: "integer" },
                    description: "Indices of similar existing articles (from the provided list).",
                  },
                },
                required: ["suggested_question", "suggested_answer", "suggested_tags", "is_duplicate", "similar_article_indices"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_faq_article" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later." }), { status: 429, headers: corsHeaders });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required for AI." }), { status: 402, headers: corsHeaders });
      }
      console.error("AI error:", response.status, await response.text());
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers: corsHeaders });
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI did not return structured output" }), { status: 500, headers: corsHeaders });
    }

    const suggestion = JSON.parse(toolCall.function.arguments);

    // Map similar article indices to actual article data
    const similarArticles = (suggestion.similar_article_indices || [])
      .filter((i: number) => existingArticles && i >= 0 && i < existingArticles.length)
      .map((i: number) => ({
        id: existingArticles![i].id,
        question: existingArticles![i].question,
      }));

    return new Response(
      JSON.stringify({
        suggested_question: suggestion.suggested_question,
        suggested_answer: suggestion.suggested_answer,
        suggested_tags: suggestion.suggested_tags,
        is_duplicate: suggestion.is_duplicate,
        similar_articles: similarArticles,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-faq-from-ticket error:", e);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
