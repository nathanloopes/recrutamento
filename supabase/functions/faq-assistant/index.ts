import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================
// RecrutaBot — IA do FAQ (orientada a PROCESSOS DO SISTEMA)
// ============================================================
// Responsabilidade: tirar dúvidas sobre COMO o sistema funciona
// (fluxo de candidatura, etapas, testes, entrevista, documentos,
// ASO, remarcação, navegação). NÃO consulta nem expõe dados
// pessoais da candidatura ativa do usuário.
// ============================================================

serve(withAuth(async (req, ctx) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const { question } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Pergunta inválida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // CrossConfig: min_confidence + domains habilitados
    let minConfidence = 0.5;
    const { data: thresholdSetting } = await supabaseAdmin
      .from("global_settings")
      .select("value")
      .eq("category", "faq")
      .eq("key", "min_confidence_threshold")
      .maybeSingle();
    if (thresholdSetting?.value != null) {
      const parsed = Number(thresholdSetting.value);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 1) minConfidence = parsed;
    }

    const { data: domainsSetting } = await supabaseAdmin
      .from("global_settings")
      .select("value")
      .eq("category", "faq")
      .eq("key", "domains_enabled")
      .maybeSingle();
    const activeDomains: string[] = Array.isArray(domainsSetting?.value)
      ? domainsSetting.value.map(String)
      : [];

    // Base de conhecimento — artigos publicados do FAQ
    const words = question
      .toLowerCase()
      .replace(/[^a-záàâãéèêíïóôõöúüçñ0-9\s]/gi, "")
      .split(/\s+/)
      .filter((w: string) => w.length > 2)
      .slice(0, 5);

    let articlesQuery = supabaseAdmin
      .from("faq_articles")
      .select("id, question, answer, tags")
      .eq("status", "publicado")
      .limit(10);

    if (words.length > 0) {
      const orFilter = words
        .map((w: string) => `question.ilike.%${w}%,answer.ilike.%${w}%`)
        .join(",");
      articlesQuery = articlesQuery.or(orFilter);
    }

    const { data: articles } = await articlesQuery;
    let matchedArticles = articles || [];
    if (activeDomains.length > 0) {
      matchedArticles = matchedArticles.filter((a: any) => {
        const tags: string[] = Array.isArray(a.tags) ? a.tags : [];
        return tags.length === 0 || tags.some((t: string) => activeDomains.includes(t));
      });
    }

    // Tom / idioma
    const { data: toneLanguageSettings } = await supabaseAdmin
      .from("global_settings")
      .select("key, value")
      .eq("category", "units")
      .in("key", ["default_tone", "default_language"]);
    const toneMap: Record<string, any> = {};
    (toneLanguageSettings || []).forEach((s: any) => {
      toneMap[s.key] = s.value;
    });
    const defaultTone =
      typeof toneMap.default_tone === "string" ? toneMap.default_tone.replace(/"/g, "") : "formal";
    const defaultLanguage =
      typeof toneMap.default_language === "string"
        ? toneMap.default_language.replace(/"/g, "")
        : "pt-BR";
    const toneInstruction =
      defaultTone === "informal"
        ? "Use um tom descontraído e amigável."
        : defaultTone === "técnico"
          ? "Use um tom técnico e preciso."
          : "Use um tom profissional e respeitoso.";

    const hasArticles = matchedArticles.length > 0;
    const articlesContext = hasArticles
      ? matchedArticles
          .map((a: any, i: number) => `[Artigo ${i + 1}] Pergunta: ${a.question}\nResposta: ${a.answer}`)
          .join("\n\n")
      : "(sem artigos diretamente relacionados — responda pelo conhecimento dos processos do sistema)";

    const systemPrompt = `Você é o RecrutaBot, assistente da plataforma de recrutamento Recruta.

PAPEL E ESCOPO
==========================================================
Sua função é EXPLICAR COMO O SISTEMA FUNCIONA — processos,
etapas e regras gerais do recrutamento. Você NÃO consulta a
candidatura específica do usuário. Se perguntarem "quando é
minha entrevista?", "qual meu status?", "por que meu documento
foi rejeitado?", oriente a pessoa a abrir o módulo correspondente
no app (Candidaturas, Documentos, Notificações).

MÓDULOS DO APP (para orientar navegação)
==========================================================
- "Início" (/inicio): resumo, próximos passos e atalhos.
- "Oportunidades" (/oportunidades): vagas disponíveis.
- "Candidaturas" (/candidaturas): status de cada candidatura, datas e detalhes.
- "Meus Testes" (/meus-testes): testes pendentes e realizados.
- "Documentos" (/documentos): envio e acompanhamento de documentos + ASO.
- "Perfil" (/perfil): dados pessoais e currículo.
- "Notificações" (/notificacoes): histórico de avisos.
- "Central de Dúvidas" (/faq): onde o candidato está agora.

CONHECIMENTO DE PROCESSOS (fonte de verdade institucional)
==========================================================
FLUXO GERAL DA CANDIDATURA
1. Candidato escolhe uma vaga em Oportunidades.
2. Realiza TESTES de triagem (quando a vaga exigir).
3. Escolhe a UNIDADE entre as disponíveis para aquela vaga.
4. Pode haver testes adicionais pós-unidade ou pós-entrevista.
5. ENTREVISTA com o recrutador (online via LiveKit ou presencial).
6. Aprovação na entrevista é SEMPRE manual (recrutador decide).
7. Após aprovação: SOLICITAÇÃO DE DOCUMENTOS.
8. Após documentos aprovados: AGENDAMENTO DO ASO (exame admissional).
9. Após ASO aprovado pelo franqueado: CONTRATAÇÃO.

STATUS POSSÍVEIS DA CANDIDATURA
- "em andamento": processo ativo.
- "standby": pausado pelo recrutador, aguardando retorno do time.
- "aprovado na etapa": passou da etapa, segue para a próxima.
- "contratado": processo concluído com sucesso.
- "desistente": o candidato encerrou.
- "encerrada": processo finalizado pela empresa.

ENTREVISTAS
- Agendamento: candidato escolhe data/horário entre os slots liberados pela unidade.
- O agendamento é confirmado automaticamente quando há slot disponível.
- A APROVAÇÃO do resultado é sempre manual, feita pelo recrutador.
- Entrevistas online geram sala LiveKit acessível em /entrevista-online/{id}.
- Remarcação: feita no módulo Candidaturas, na entrevista correspondente.
- No-show abre janela de 24h para remarcar; caso contrário a candidatura vai para standby.

TESTES
- Testes podem aparecer em três momentos: triagem inicial, após escolher unidade ou após entrevista aprovada.
- Testes pós-entrevista só são liberados depois que o recrutador aprova manualmente a entrevista.
- O candidato faz pelo módulo "Meus Testes".

DOCUMENTOS
- Só são solicitados APÓS aprovação na entrevista.
- O recrutador define o checklist; o candidato envia pelo módulo "Documentos".
- Documentos rejeitados precisam ser reenviados (motivo é exibido no app).

ASO (Atestado de Saúde Ocupacional)
- Liberado APÓS todos os documentos serem aprovados.
- A unidade envia endereço, data e horário do exame admissional.
- Após o exame, a equipe de recrutamento anexa o laudo no módulo de Documentação.
- O franqueado valida o ASO; só após essa validação a contratação é efetivada.

REATIVAÇÃO DE CANDIDATURA
- Quando reaberta, sempre inicia um novo ciclo limpo.

==========================================================
HIERARQUIA DE FONTES (use nesta ordem)
==========================================================
1) BASE DE FAQ abaixo (se houver artigo relevante).
2) Conhecimento dos PROCESSOS DO SISTEMA descrito acima.
3) Lista de MÓDULOS do app (para orientar navegação).
4) Se a dúvida for sobre dados pessoais da candidatura do usuário,
   oriente-o a abrir o módulo correto no app — NÃO invente datas,
   status, valores nem nomes.

==========================================================
LINGUAGEM NEUTRA (obrigatório)
==========================================================
NUNCA use "tranquila/o", "bem-vinda/o", "preparada/o", "obrigada/o",
"querida/o", "prezad@". Prefira "tudo certo", "que bom te ver por aqui",
"tudo pronto", "valeu".

==========================================================
ESTILO
==========================================================
- ${toneInstruction}
- Idioma: ${defaultLanguage === "pt-BR" ? "português brasileiro" : defaultLanguage}.
- Até 4 frases, direto ao ponto, focado em EXPLICAR o processo.
- NUNCA invente prazos, valores, regras ou políticas que não estejam
  descritos acima ou no FAQ.

==========================================================
SAÍDA ESTRUTURADA (tool faq_response)
==========================================================
- "answer": explicação clara e prática sobre o processo (até 4 frases).
- "confidence":
    0.80–0.95 quando respondeu por artigo direto do FAQ ou processo bem definido acima.
    0.55–0.70 quando respondeu por navegação/módulos.
    0.30–0.45 quando a pergunta foge do escopo do recrutamento.
- "matched_article_indices": índices 1-based dos artigos usados (vazio se respondeu por processo).
- "resolved": true se respondeu de forma útil; false se realmente não havia base.

==========================================================
BASE DE CONHECIMENTO (FAQ):
${articlesContext}`;

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "faq_response",
              description: "Retorna a resposta estruturada para a dúvida do candidato",
              parameters: {
                type: "object",
                properties: {
                  answer: { type: "string", description: "Resposta clara e objetiva" },
                  confidence: { type: "number", description: "Confiança de 0 a 1" },
                  matched_article_indices: {
                    type: "array",
                    items: { type: "integer" },
                    description: "Índices (1-based) dos artigos usados",
                  },
                  resolved: { type: "boolean", description: "true se respondeu de forma útil" },
                },
                required: ["answer", "confidence", "matched_article_indices", "resolved"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "faq_response" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await aiResponse.text();
      console.error("OpenAI error:", aiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: `OpenAI ${aiResponse.status}: ${errText.slice(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    const directContent = aiData.choices?.[0]?.message?.content;

    let result = {
      answer: "",
      confidence: 0,
      matched_article_indices: [] as number[],
      resolved: false,
    };

    if (toolCall?.function?.arguments) {
      try {
        result = JSON.parse(toolCall.function.arguments);
      } catch (parseErr) {
        console.error("Failed to parse tool call arguments:", parseErr, toolCall.function.arguments);
      }
    }

    if (!result.answer && directContent) {
      result = {
        answer: directContent,
        confidence: 0.5,
        matched_article_indices: [],
        resolved: true,
      };
    }

    if (!result.answer) {
      result = {
        answer: "Desculpe, não consegui processar sua dúvida agora. Tente reformular ou abrir um chamado.",
        confidence: 0.2,
        matched_article_indices: [],
        resolved: false,
      };
    }

    const matchedIds = result.matched_article_indices
      .filter((i: number) => i >= 1 && i <= matchedArticles.length)
      .map((i: number) => matchedArticles[i - 1].id);

    const isResolved = result.resolved && result.confidence >= minConfidence;
    const logStatus = isResolved ? "resolvido_ia" : "pendente";

    const { data: logEntry, error: logError } = await supabaseAdmin
      .from("faq_ai_logs")
      .insert({
        user_id: ctx.userId,
        question: question.trim(),
        matched_article_ids: matchedIds,
        answer: result.answer,
        confidence: result.confidence,
        status: logStatus,
      })
      .select("id")
      .single();

    const finalLogId: string | null = logEntry?.id || null;
    if (logError) {
      console.warn("faq_ai_log insert issue (continuing):", logError.code, logError.message);
    }

    const relatedArticles = matchedIds
      .map((id: string) => {
        const art = matchedArticles.find((a: any) => a.id === id);
        return art ? { id: art.id, question: art.question, answer: art.answer } : null;
      })
      .filter(Boolean);

    return new Response(
      JSON.stringify({
        answer: result.answer,
        confidence: result.confidence,
        resolved: isResolved,
        log_id: finalLogId,
        related_articles: relatedArticles,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("faq-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
