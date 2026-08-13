// Sara — resposta conversacional contextual dentro do chat humano existente.
// Disparada (a) por trigger AFTER INSERT em conversation_messages quando o
// candidato envia uma mensagem, ou (b) pelo cron `sara_tick` como rede de
// segurança. A função carrega contexto da candidatura (vaga, etapa, entrevista,
// documentos, pendências) e gera uma resposta no tom da Sara.

// @ts-ignore deno remote
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const DEBOUNCE_MS = 15_000; // 15s — janela curta pra humano assumir
const MAX_REPLY_CHARS = 700;

const SARA_SYSTEM_PROMPT = `Você é Sara.
Você trabalha no recrutamento da franquia Recruta.
Sua função é acompanhar candidatos durante todas as etapas do processo seletivo.

Você NUNCA deve se apresentar como: IA, robô, sistema, automação, assistente.
Aja como uma recrutadora humana moderna conversando pelo WhatsApp.

========================================================
PRINCÍPIO FUNDAMENTAL — RESPONDA PELO ESTADO, NÃO PELO TEXTO
========================================================
Você NÃO é um chatbot que responde palavras-chave. Você é uma agente de
recrutamento que primeiro entende a SITUAÇÃO REAL do candidato no sistema
e SÓ DEPOIS constrói a resposta. Mesmo perguntas vagas como "em que etapa
estou?" ou "o que preciso fazer?" DEVEM ser respondidas a partir do estado
operacional concreto (eventos agendados, pendências, próxima etapa).

NUNCA confunda "aprovado" no funil com "contratado". "Aprovado" é só uma
etapa do processo — ainda pode haver teste presencial, documentos,
entrevistas adicionais ou aguardo de admissão pela frente. Identifique a
ETAPA OPERACIONAL REAL (campo "ETAPA ATUAL" no diagnóstico), não o rótulo
genérico da candidatura.

========================================================
PROTOCOLO OBRIGATÓRIO — 10 VERIFICAÇÕES ANTES DE RESPONDER
========================================================
Antes de redigir QUALQUER resposta, percorra mentalmente nesta ordem,
usando o bloco "DIAGNÓSTICO DO PROCESSO" como única fonte da verdade:

  1. ETAPA ATUAL — qual o valor exato de "ETAPA ATUAL"?
  2. ÚLTIMA MOVIMENTAÇÃO — qual o evento mais recente em "Últimos eventos
     da jornada"?
  3. EVENTOS FUTUROS — há entrevista, teste presencial ou prazo
     agendado? Datas e horários?
  4. ENTREVISTA AGENDADA — existe "Entrevista FUTURA" com data >= hoje?
  5. TESTE PRESENCIAL AGENDADO — existe "Teste presencial AGENDADO"?
  6. DOCUMENTAÇÃO PENDENTE — há documentos pendentes, rejeitados ou
     vencidos?
  7. CONTRATAÇÃO CONCLUÍDA — status = "contratado"?
  8. REPROVAÇÃO/DESISTÊNCIA — entrevista reprovada, teste reprovado,
     desistente, desligado?
  9. AÇÕES DO CANDIDATO — o que ele precisa FAZER agora (enviar doc,
     comparecer, concluir teste, escolher data)?
 10. PRÓXIMA ETAPA — qual o valor exato de "PRÓXIMO PASSO"?

Só depois disso, formule a resposta.

========================================================
HIERARQUIA DE PRIORIDADE NA RESPOSTA
========================================================
Quando for construir a frase, priorize informações nesta ordem:
  1) Eventos agendados + ações pendentes (data, hora, local, doc faltando)
  2) Próxima etapa do processo (campo "PRÓXIMO PASSO")
  3) Última movimentação registrada (jornada)
  4) Status geral da candidatura
  5) Histórico da conversa

EXEMPLO — Pergunta: "Em que etapa estou? O que preciso fazer?"

  ERRADO: "Você está aprovado e aguarde contato."
  CERTO : "Atualmente você está na etapa de teste presencial. Seu teste
           está agendado para 22/06/2026 às 09:00 na unidade. É importante
           comparecer no horário marcado. Depois dessa etapa o processo
           segue para as próximas fases."

========================================================
FONTES DE DADOS
========================================================
Você recebe DOIS blocos: "DIAGNÓSTICO DO PROCESSO" (estado real do sistema)
e, quando aplicável, "BASE DE CONHECIMENTO (FAQ)" para perguntas
institucionais (políticas, benefícios padrão, etc.).

Regras de uso:
  - Perguntas sobre o PROCESSO do candidato (etapa, datas, entrevista,
    teste, documento, próximo passo, status, vaga, salário desta vaga,
    endereço da unidade) → SEMPRE responda a partir do DIAGNÓSTICO.
  - Perguntas institucionais sem dado no diagnóstico → use o FAQ.
  - Se a informação puder ser DERIVADA combinando dois campos do
    diagnóstico, derive — não diga "não sei".
  - Só responda "Vou conferir com o time aqui e já te trago um retorno."
    se REALMENTE não houver nada no diagnóstico nem no FAQ que permita
    responder.

========================================================
AUTO-VERIFICAÇÃO FINAL (antes de enviar)
========================================================
Pergunte-se:
  - Onde esse candidato está no processo? (ETAPA ATUAL)
  - O que aconteceu por último? (jornada)
  - O que está marcado para acontecer? (eventos futuros)
  - Existe alguma ação esperada do candidato? (pendências)
  - Qual é a próxima etapa? (PRÓXIMO PASSO)
  - Minha resposta está consistente com o sistema? (sem inventar entrevista
    que já passou, sem pedir doc aprovado, sem prometer contratação)

Se qualquer resposta for "não", reescreva.

========================================================
REGRAS DURAS DE COERÊNCIA
========================================================
- Entrevista "realizada", "concluída", "no_show", "cancelada", "aprovada"
  ou "reprovada" NUNCA é próximo passo nem tem data futura.
- Candidatura "contratada" → processo concluído, não fale em próximas
  etapas seletivas.
- Candidatura "aprovada" NÃO significa contratação — verifique se ainda
  há teste presencial, documentos ou entrevista a fazer.
- Documentos APROVADOS não são pedidos de novo. REJEITADO/EXPIRADO/EM
  CORREÇÃO → cite pelo nome exato.
- Testes CONCLUÍDOS, APROVADOS ou REPROVADOS não são "pendentes".
- Cancelamento, desistência, reprovação, encerramento → reconheça;
  não trate como ativo.

========================================================
QUANDO O CANDIDATO SINALIZA IMPREVISTO / NÃO PODE COMPARECER
========================================================
Se a mensagem do candidato indicar que ele NÃO conseguirá comparecer,
precisa cancelar, remarcar, atrasar ou tem um imprevisto ("não vou
conseguir", "não posso ir", "não dá pra participar", "preciso remarcar",
"vou atrasar", "não consigo hoje", "estou doente"):

  - NUNCA responda "Vou conferir com o time aqui e já te trago um retorno."
  - Se houver Entrevista futura no diagnóstico: reconheça com empatia
    curta e diga que dá pra escolher outra data por aqui mesmo (o app
    mostra o botão de remarcar). Ex: "Sem problema, imprevistos
    acontecem. Você consegue escolher uma nova data por aqui mesmo, tá?"
  - Se houver Teste presencial agendado: mesma lógica, oferecer
    remarcar/entrar em contato com a unidade.
  - Se não houver evento futuro claro, apenas confirme que anotou e o
    time é avisado — sem prometer contato específico.

========================================================
QUANDO A MENSAGEM DO CANDIDATO É SOCIAL/CURTA (sem pergunta)
========================================================
Mensagens como "ok", "beleza", "entendi", "obrigado", "certo", "tá bom",
emojis isolados: NÃO gere uma nova explicação sobre a etapa. Apenas
confirme de forma breve ("Combinado!", "Tô por aqui se precisar.") OU,
se a mensagem anterior da Sara já cobriu tudo, responda com "fonte":
"sem_dados" e "resposta" vazia — o sistema vai suprimir o envio.
NUNCA repita o resumo da etapa se a última mensagem da Sara já disse
o mesmo. Evite mandar duas mensagens seguidas com o mesmo conteúdo.

========================================================
TOM E ESTILO
========================================================
- Humana, leve, acolhedora, objetiva, natural. Estilo WhatsApp, mensagens
  curtas com quebras naturais.
- Sem emojis, sem listas numeradas/bullets, sem títulos em negrito, sem
  tom corporativo ("prezado", "atenciosamente", "cordialmente").
- Máximo absoluto: 700 caracteres.
- Cite valores e datas concretos quando existirem (salário em R$,
  horário HH:MM, endereço com bairro).

========================================================
LINGUAGEM NEUTRA DE GÊNERO (obrigatório)
========================================================
NUNCA use: "tranquila/tranquilo", "bem-vinda/bem-vindo", "preparada/preparado",
"obrigada/obrigado", "querida/querido", "prezad@".
Prefira: "tudo certo", "que bom te ver por aqui", "tudo pronto", "valeu mesmo".

========================================================
BOTÕES DE AÇÃO
========================================================
- O app adiciona automaticamente os botões. NÃO escreva URLs, "clique aqui",
  "acesse o menu X" nem repita o nome do botão. Só descreva a ação em
  uma frase curta.

========================================================
PROIBIÇÕES ABSOLUTAS
========================================================
- Tratar "aprovado" como "contratado" ou "pré-contratado" sem checar etapa.
- Prometer contratação, aprovação ou data de admissão.
- Inventar benefícios, horários, salários, prazos ou datas que NÃO estão
  no DIAGNÓSTICO/FAQ.
- Pedir CPF, senha, cartão ou documentos sensíveis no chat.
- Citar entrevistas já realizadas como próximo passo.
- Solicitar documentos já aprovados.
- Ignorar reprovações, rejeições, remarcações, cancelamentos.
- Dizer "não tenho essa informação" ou "fale com a unidade" SEM antes
  percorrer as 10 verificações.
- Responder a partir do TEXTO da pergunta sem antes consultar o ESTADO.
- Expor o bloco DIAGNÓSTICO/FAQ em si — apenas usar as informações.

========================================================
FORMATO DE SAÍDA (obrigatório)
========================================================
Responda EXCLUSIVAMENTE com um JSON válido neste formato exato:
{
  "raciocinio": "<execução das 10 verificações em 2-4 linhas internas, NUNCA exibido ao candidato>",
  "fonte": "diagnostico" | "faq" | "diagnostico+faq" | "derivado" | "sem_dados",
  "resposta": "<mensagem final no tom da Sara para o candidato>"
}
Se "fonte" = "sem_dados", "resposta" DEVE ser exatamente:
"Vou conferir com o time aqui e já te trago um retorno."

MISSÃO
Faça o candidato sentir que existe alguém acompanhando ele de verdade, com
clareza sobre onde ele está e o que vem a seguir — sempre baseado no
ESTADO REAL do sistema, nunca no texto isolado da pergunta.`;

// Sanitização de termos com flexão de gênero → neutros
const GENDERED_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\btranquil[oa]\b/gi, "tudo certo"],
  [/\bbem[-\s]vind[oa]\b/gi, "que bom te ver por aqui"],
  [/\bpreparad[oa]\b/gi, "pronto pra seguir"],
  [/\bobrigad[oa]\b/gi, "valeu"],
  [/\bquerid[oa]\b/gi, "tudo bem"],
  [/\bprezad[oa]\b/gi, "olá"],
  [/\batenciosamente\b/gi, ""],
  [/\bcordialmente\b/gi, ""],
];

function sanitizeReply(text: string): string {
  let out = text.trim();
  for (const [re, rep] of GENDERED_REPLACEMENTS) out = out.replace(re, rep);
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (out.length > MAX_REPLY_CHARS) {
    const cut = out.slice(0, MAX_REPLY_CHARS);
    const lastBreak = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf(". "));
    out = (lastBreak > 200 ? cut.slice(0, lastBreak) : cut).trim();
  }
  return out;
}

// Detecta se um texto é (ou contém) o JSON interno { raciocinio, fonte, resposta }.
// Esse bloco NUNCA pode ser enviado como mensagem ao candidato/recrutador — serve
// como rede de segurança caso o parse extraia o objeto cru por engano.
function looksLikeInternalJson(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  // "raciocinio" quotado + dois-pontos jamais aparece numa mensagem real da Sara.
  if (/"\s*raciocinio\s*"\s*:/.test(t)) return true;
  // Objeto JSON que carrega os campos de fonte e resposta juntos.
  if (t.startsWith("{") && /"\s*fonte\s*"\s*:/.test(t) && /"\s*resposta\s*"\s*:/.test(t)) return true;
  return false;
}

function fmtDateBR(ymd: string | null): string | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}
function fmtTimeBR(t: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

// Mapas de tradução
const STATUS_PT: Record<string, string> = {
  pendente: "em triagem",
  em_andamento: "em andamento",
  aprovado: "aprovada no funil (NÃO equivale a contratação — pode haver teste presencial, documentos ou novas etapas)",
  contratado: "contratada (já contratado)",
  standby: "em pausa (standby)",
  desligado: "encerrada",
  desistente: "encerrada por desistência",
};

function todayYMD(): string {
  // Brasil (BRT)
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  return brt.toISOString().slice(0, 10);
}

// Normaliza status de entrevista em uma das categorias de negócio
function classifyInterview(status: string, dateYMD: string | null, today: string): string {
  const s = String(status || "").toLowerCase();
  if (["cancelled", "canceled", "cancelada"].includes(s)) return "cancelada";
  if (["rescheduled", "remarcada"].includes(s)) return "remarcada";
  if (["no_show", "nao_compareceu"].includes(s)) return "no_show";
  if (["completed", "realizada", "concluida", "concluída"].includes(s)) return "realizada";
  if (["approved", "aprovada", "aprovado"].includes(s)) return "aprovada";
  if (["rejected", "reprovada", "reprovado"].includes(s)) return "reprovada";
  if (["confirmed", "confirmada"].includes(s)) {
    return dateYMD && dateYMD >= today ? "confirmada" : "realizada";
  }
  if (["scheduled", "agendada"].includes(s)) {
    return dateYMD && dateYMD >= today ? "agendada" : "realizada";
  }
  return s || "desconhecida";
}

function classifyDoc(status: string, expiresAt: string | null, today: string): string {
  const s = String(status || "").toLowerCase();
  if (["rejected", "reprovado", "rejeitado"].includes(s)) return "rejeitado";
  if (["approved", "aprovado", "validated", "validado"].includes(s)) {
    if (expiresAt && expiresAt.slice(0, 10) < today) return "vencido";
    return "aprovado";
  }
  if (["needs_correction", "correcao", "correção"].includes(s)) return "correcao";
  if (["in_review", "em_analise", "em_análise", "review"].includes(s)) return "em_analise";
  if (["pending", "pendente", "uploaded", "enviado"].includes(s)) return "em_analise";
  return s || "pendente";
}

function classifyTest(status: string): string {
  const s = String(status || "").toLowerCase();
  if (["pendente", "pending", "nao_iniciado", "não_iniciado"].includes(s)) return "nao_iniciado";
  if (["em_andamento", "in_progress"].includes(s)) return "em_andamento";
  if (["aprovado", "approved"].includes(s)) return "aprovado";
  if (["reprovado", "rejected"].includes(s)) return "reprovado";
  if (["concluido", "concluído", "completed", "avaliado"].includes(s)) return "concluido";
  if (["expirado", "expired"].includes(s)) return "expirado";
  return s || "desconhecido";
}

async function buildCandidateContext(
  supabase: ReturnType<typeof createClient>,
  applicationId: string | null,
  candidateId: string,
): Promise<{ contextBlock: string; derived: Derived }> {
  const lines: string[] = ["DIAGNÓSTICO DO PROCESSO (uso interno — nunca exiba)"];
  const emptyDerived = (etapa: string): Derived => ({
    etapa, appId: applicationId, appStatus: "em_andamento",
    docsState: "none", docRejectedNames: [], docPendingNames: [],
    hasPendingTest: false, pendingTestId: null,
    hasFutureInterview: false, lastCancelledNoFuture: false,
  });

  const { data: cand } = await supabase
    .from("candidates")
    .select("full_name")
    .eq("id", candidateId)
    .maybeSingle();
  const firstName = (cand?.full_name || "").trim().split(/\s+/)[0] || null;
  if (firstName) lines.push(`Nome: ${firstName}`);

  if (!applicationId) {
    lines.push("CANDIDATURA: nenhuma candidatura ativa");
    lines.push("ETAPA ATUAL: sem_candidatura");
    lines.push("PRÓXIMO PASSO: Procurar uma vaga no app.");
    return { contextBlock: lines.join("\n"), derived: emptyDerived("sem_candidatura") };
  }

  const { data: app } = await supabase
    .from("applications")
    .select("id, status, unit_job_id, created_at, withdrawal_reason, standby_reason, current_cycle")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) {
    lines.push("CANDIDATURA: não encontrada");
    lines.push("ETAPA ATUAL: indefinida");
    lines.push("PRÓXIMO PASSO: (vazio)");
    return { contextBlock: lines.join("\n"), derived: emptyDerived("indefinida") };
  }


  const today = todayYMD();
  const appStatus = String((app as any).status || "em_andamento");
  lines.push(`Status candidatura: ${STATUS_PT[appStatus] || appStatus}`);
  if ((app as any).created_at) {
    lines.push(`Candidatou-se em: ${fmtDateBR(String((app as any).created_at).slice(0, 10))}`);
  }
  if (appStatus === "standby" && (app as any).standby_reason) {
    lines.push(`Motivo standby: ${(app as any).standby_reason}`);
  }
  if (appStatus === "desistente" && (app as any).withdrawal_reason) {
    lines.push(`Motivo desistência: ${(app as any).withdrawal_reason}`);
  }

  // Vaga + unidade (detalhada)
  if ((app as any).unit_job_id) {
    const { data: uj } = await supabase
      .from("unit_jobs")
      .select("job_id, unit_id, status, salary, salary_min, salary_max, work_model, contract_type, work_hours_weekly, opens_at, closes_at, openings, address_cep, address_street, address_number, address_neighborhood, address_city, address_state, address_complement, benefits_override, responsibilities_override, requirements_override")
      .eq("id", (app as any).unit_job_id)
      .maybeSingle();
    if (uj) {
      const u = uj as any;
      const [{ data: job }, { data: unit }] = await Promise.all([
        supabase.from("jobs").select("title, description, benefits, responsibilities, requirements, category").eq("id", u.job_id).maybeSingle(),
        supabase.from("units").select("name, city, state, cep").eq("id", u.unit_id).maybeSingle(),
      ]);
      const j = (job as any) || {};
      const un = (unit as any) || {};
      const jobTitle = j.title || "vaga";
      const unitLabel = [un.name, u.address_neighborhood || un.city].filter(Boolean).join(" — ");
      lines.push(`Vaga: ${jobTitle}${unitLabel ? ` (${unitLabel})` : ""}`);
      if (j.category) lines.push(`Categoria da vaga: ${j.category}`);
      const ujStatus = String(u.status || "").toLowerCase();
      if (["closed", "encerrada", "cancelled", "cancelada", "inactive"].includes(ujStatus)) {
        lines.push(`Status da vaga: ENCERRADA/INATIVA (${ujStatus})`);
      }
      // Salário
      const fmtBRL = (n: any) => {
        const v = Number(n);
        if (!isFinite(v) || v <= 0) return null;
        return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
      };
      const salFixo = fmtBRL(u.salary);
      const salMin = fmtBRL(u.salary_min);
      const salMax = fmtBRL(u.salary_max);
      if (salFixo) lines.push(`Salário: ${salFixo}`);
      else if (salMin && salMax) lines.push(`Salário: de ${salMin} a ${salMax}`);
      else if (salMin) lines.push(`Salário a partir de: ${salMin}`);
      // Jornada
      if (u.work_hours_weekly) lines.push(`Carga horária semanal: ${u.work_hours_weekly}h`);
      if (u.opens_at || u.closes_at) lines.push(`Horário: ${u.opens_at ? String(u.opens_at).slice(0,5) : "?"} às ${u.closes_at ? String(u.closes_at).slice(0,5) : "?"}`);
      if (u.work_model) lines.push(`Modelo: ${u.work_model}`);
      if (u.contract_type) lines.push(`Contrato: ${u.contract_type}`);
      if (u.openings) lines.push(`Vagas em aberto: ${u.openings}`);
      // Endereço completo
      const endereco = [
        u.address_street && `${u.address_street}${u.address_number ? `, ${u.address_number}` : ""}`,
        u.address_complement,
        u.address_neighborhood,
        u.address_city && u.address_state ? `${u.address_city}/${u.address_state}` : (u.address_city || u.address_state),
        u.address_cep && `CEP ${u.address_cep}`,
      ].filter(Boolean).join(" — ");
      if (endereco) lines.push(`Endereço da unidade: ${endereco}`);
      // Benefícios
      const benefits = u.benefits_override || j.benefits;
      if (Array.isArray(benefits) && benefits.length > 0) {
        const labels = benefits.map((b: any) => typeof b === "string" ? b : (b?.name || b?.label || b?.title)).filter(Boolean);
        if (labels.length) lines.push(`Benefícios: ${labels.join(", ")}`);
      } else if (typeof benefits === "string" && benefits.trim()) {
        lines.push(`Benefícios: ${benefits.trim()}`);
      }
      // Responsabilidades / requisitos resumidos
      const resp = u.responsibilities_override || j.responsibilities;
      if (typeof resp === "string" && resp.trim()) lines.push(`Responsabilidades: ${resp.trim().slice(0, 400)}`);
      const req = u.requirements_override || j.requirements;
      if (typeof req === "string" && req.trim()) lines.push(`Requisitos: ${req.trim().slice(0, 400)}`);
      if (typeof j.description === "string" && j.description.trim()) {
        lines.push(`Descrição da vaga: ${j.description.trim().slice(0, 400)}`);
      }
    }
  }

  // Dados do candidato (cidade/bairro p/ contexto)
  const { data: prof } = await supabase
    .from("candidate_profiles")
    .select("city, state, address_json")
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (prof) {
    const p = prof as any;
    const bairro = (p.address_json && typeof p.address_json === "object") ? (p.address_json.neighborhood || p.address_json.bairro) : null;
    const loc = [bairro, p.city, p.state].filter(Boolean).join(" / ");
    if (loc) lines.push(`Candidato mora em: ${loc}`);
  }


  // ====== ENTREVISTAS ======
  const { data: allInterviews } = await supabase
    .from("interviews")
    .select("id, status, scheduled_date, scheduled_time, modality, meeting_link, reschedule_count, reschedule_reason, created_at")
    .eq("application_id", applicationId)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const interviews = (allInterviews || []) as any[];

  // Feedbacks por entrevista
  let feedbackByInterview: Record<string, string> = {};
  if (interviews.length > 0) {
    const ids = interviews.map((i) => i.id);
    const { data: fb } = await supabase
      .from("interview_feedback")
      .select("interview_id, decision, created_at")
      .in("interview_id", ids)
      .order("created_at", { ascending: false });
    for (const f of (fb || []) as any[]) {
      if (!feedbackByInterview[f.interview_id]) {
        feedbackByInterview[f.interview_id] = String(f.decision || "").toLowerCase();
      }
    }
  }

  const interviewClassified = interviews.map((i) => ({
    ...i,
    cat: classifyInterview(i.status, i.scheduled_date ? String(i.scheduled_date) : null, today),
    decision: feedbackByInterview[i.id] || null,
  }));

  const future = interviewClassified
    .filter((i) => ["agendada", "confirmada"].includes(i.cat))
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))[0];
  const lastPast = interviewClassified.find((i) =>
    ["realizada", "no_show", "aprovada", "reprovada"].includes(i.cat),
  );
  const lastCancelled = interviewClassified.find((i) => i.cat === "cancelada");
  const rescheduleCount = interviewClassified.reduce((acc, i) => acc + (Number(i.reschedule_count) || 0), 0);
  const interviewApproved =
    interviewClassified.some((i) => i.decision && ["aprovado", "approved", "aprovada"].includes(i.decision)) ||
    ["aprovado", "contratado"].includes(appStatus);
  const interviewRejected = interviewClassified.some(
    (i) => i.decision && ["reprovado", "rejected", "reprovada"].includes(i.decision),
  );

  if (interviews.length === 0) {
    lines.push("Entrevistas: nenhuma registrada");
  } else {
    if (future) {
      const d = fmtDateBR(future.scheduled_date);
      const t = fmtTimeBR(future.scheduled_time);
      const mod = future.modality || "online";
      const link = future.meeting_link ? " (link disponível no app)" : "";
      lines.push(`Entrevista FUTURA: ${future.cat.toUpperCase()} para ${d} às ${t} — ${mod}${link}`);
    } else {
      lines.push("Entrevista FUTURA: nenhuma agendada no momento");
    }
    if (lastPast) {
      const d = fmtDateBR(lastPast.scheduled_date);
      let extra = "";
      if (lastPast.decision) extra = ` — parecer: ${lastPast.decision}`;
      else if (lastPast.cat === "no_show") extra = " — candidato não compareceu";
      lines.push(`Última entrevista PASSADA: ${lastPast.cat} em ${d}${extra} (NÃO citar como próximo passo)`);
    }
    if (lastCancelled && (!lastPast || String(lastCancelled.scheduled_date) > String(lastPast.scheduled_date || ""))) {
      lines.push(`Última entrevista CANCELADA em ${fmtDateBR(lastCancelled.scheduled_date)}${lastCancelled.reschedule_reason ? ` — motivo: ${lastCancelled.reschedule_reason}` : ""}`);
    }
    if (rescheduleCount > 0) lines.push(`Remarcações no histórico: ${rescheduleCount}`);
  }

  // ====== DOCUMENTOS ======
  const { data: docReq } = await supabase
    .from("document_requests")
    .select("id, status, documents_list, custom_documents, created_at, completed_at, deadline_date")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let docsState: "none" | "pending" | "in_review" | "completed" | "has_rejected" = "none";
  let docPendingNames: string[] = [];
  let docRejectedNames: string[] = [];
  let docApprovedNames: string[] = [];
  let docExpiredNames: string[] = [];

  if (docReq) {
    const requestedList: string[] = [];
    const dl = (docReq as any).documents_list;
    const cl = (docReq as any).custom_documents;
    if (Array.isArray(dl)) for (const x of dl) requestedList.push(typeof x === "string" ? x : (x?.name || x?.type || "documento"));
    if (Array.isArray(cl)) for (const x of cl) requestedList.push(typeof x === "string" ? x : (x?.name || x?.type || "documento"));

    const { data: uploads } = await supabase
      .from("document_uploads")
      .select("document_type, status, rejection_reason, uploaded_at, validated_at")
      .eq("request_id", (docReq as any).id)
      .order("uploaded_at", { ascending: false });

    const latestByType: Record<string, any> = {};
    for (const u of (uploads || []) as any[]) {
      const t = String(u.document_type || "").toLowerCase();
      if (!latestByType[t]) latestByType[t] = u;
    }

    for (const name of requestedList) {
      const key = String(name).toLowerCase();
      const u = latestByType[key];
      if (!u) {
        docPendingNames.push(name);
        continue;
      }
      const cat = classifyDoc(u.status, null, today);
      if (cat === "aprovado") docApprovedNames.push(name);
      else if (cat === "rejeitado") docRejectedNames.push(`${name}${u.rejection_reason ? ` (motivo: ${u.rejection_reason})` : ""}`);
      else if (cat === "vencido") docExpiredNames.push(name);
      else docPendingNames.push(`${name} (em análise)`);
    }

    if (docRejectedNames.length > 0) docsState = "has_rejected";
    else if (docPendingNames.length > 0) docsState = docPendingNames.some((n) => n.includes("(em análise)")) ? "in_review" : "pending";
    else if ((docReq as any).completed_at || String((docReq as any).status || "").toLowerCase() === "completed") docsState = "completed";
    else if (requestedList.length > 0 && docApprovedNames.length === requestedList.length) docsState = "completed";
    else docsState = "in_review";

    lines.push(`Documentos solicitados: ${requestedList.length}`);
    if (docApprovedNames.length) lines.push(`Documentos APROVADOS: ${docApprovedNames.join(", ")}`);
    if (docRejectedNames.length) lines.push(`Documentos REJEITADOS (reenviar): ${docRejectedNames.join("; ")}`);
    if (docExpiredNames.length) lines.push(`Documentos VENCIDOS: ${docExpiredNames.join(", ")}`);
    if (docPendingNames.length) lines.push(`Documentos PENDENTES de envio/análise: ${docPendingNames.join(", ")}`);
    if ((docReq as any).deadline_date) lines.push(`Prazo para documentos: ${fmtDateBR(String((docReq as any).deadline_date).slice(0, 10))}`);
  } else {
    lines.push("Documentos: nenhuma solicitação criada ainda");
  }

  // ====== TESTES ======
  const { data: testsData } = await supabase
    .from("test_assignments")
    .select("id, status, score, deadline, completed_at, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  const tests = (testsData || []) as any[];
  const testsByCat: Record<string, number> = {};
  let pendingTestId: string | null = null;
  for (const t of tests) {
    const c = classifyTest(t.status);
    testsByCat[c] = (testsByCat[c] || 0) + 1;
    if (!pendingTestId && (c === "nao_iniciado" || c === "em_andamento")) pendingTestId = t.id;
  }
  if (tests.length === 0) lines.push("Testes: nenhum atribuído");
  else {
    const parts = Object.entries(testsByCat).map(([k, v]) => `${v} ${k}`);
    lines.push(`Testes: ${parts.join(", ")}`);
  }
  const hasPendingTest = (testsByCat["nao_iniciado"] || 0) + (testsByCat["em_andamento"] || 0) > 0;
  const hasRejectedTest = (testsByCat["reprovado"] || 0) > 0;

  // ====== TESTE PRESENCIAL AGENDADO (test_bookings) ======
  const { data: bookingsData } = await supabase
    .from("test_bookings")
    .select("id, status, scheduled_date, scheduled_time, end_time, modality, notes, created_at")
    .eq("application_id", applicationId)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const bookings = (bookingsData || []) as any[];
  const futureBooking = bookings
    .filter((b) => {
      const s = String(b.status || "").toLowerCase();
      if (["cancelled", "canceled", "cancelada", "no_show"].includes(s)) return false;
      return b.scheduled_date && String(b.scheduled_date) >= today;
    })
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))[0];
  const pastBooking = bookings.find((b) => {
    const s = String(b.status || "").toLowerCase();
    if (["completed", "realizada", "concluida", "concluído"].includes(s)) return true;
    return b.scheduled_date && String(b.scheduled_date) < today;
  });
  if (bookings.length === 0) {
    lines.push("Teste presencial: nenhum agendamento");
  } else if (futureBooking) {
    const d = fmtDateBR(futureBooking.scheduled_date);
    const t = fmtTimeBR(futureBooking.scheduled_time);
    const mod = futureBooking.modality || "presencial";
    lines.push(`Teste presencial AGENDADO: ${d} às ${t} — ${mod}${futureBooking.notes ? ` (obs: ${futureBooking.notes})` : ""}`);
  } else if (pastBooking) {
    lines.push(`Último teste presencial em ${fmtDateBR(pastBooking.scheduled_date)} — status: ${pastBooking.status} (NÃO citar como próximo passo)`);
  }

  // ====== JORNADA (últimos eventos) ======
  const { data: events } = await supabase
    .from("application_journey_events")
    .select("event_type, phase_label, to_status, skip_reason, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(15);
  if (events && events.length > 0) {
    lines.push("Últimos eventos da jornada (mais recentes primeiro):");
    for (const e of events as any[]) {
      const when = fmtDateBR(String(e.created_at).slice(0, 10));
      const lbl = [e.event_type, e.phase_label, e.to_status].filter(Boolean).join(" / ");
      lines.push(`  - ${when}: ${lbl}${e.skip_reason ? ` (pulado: ${e.skip_reason})` : ""}`);
    }
  }

  // ====== DERIVAÇÃO ETAPA + PRÓXIMO PASSO ======
  let etapa = "em_andamento";
  let proximo = "";

  if (appStatus === "contratado") {
    etapa = "contratado";
    proximo = "Processo concluído — qualquer dúvida sobre o início, falar com a unidade.";
  } else if (appStatus === "desistente") {
    etapa = "encerrada_desistencia";
    proximo = "";
  } else if (appStatus === "desligado") {
    etapa = "encerrada";
    proximo = "";
  } else if (appStatus === "standby") {
    etapa = "standby";
    proximo = "Aguardar retorno do time. O processo está pausado no momento.";
  } else if (interviewRejected) {
    etapa = "entrevista_reprovada";
    proximo = "";
  } else if (futureBooking) {
    etapa = "teste_presencial_agendado";
    proximo = `Comparecer ao teste presencial em ${fmtDateBR(futureBooking.scheduled_date)} às ${fmtTimeBR(futureBooking.scheduled_time)} na unidade.`;
  } else if (appStatus === "aprovado") {
    if (docsState === "has_rejected") {
      etapa = "documentos_com_rejeicao";
      proximo = `Reenviar o(s) documento(s) rejeitado(s): ${docRejectedNames.join("; ")}.`;
    } else if (docsState === "pending") {
      etapa = "documentos_pendentes";
      proximo = `Enviar o(s) documento(s) pendente(s): ${docPendingNames.join(", ")}.`;
    } else if (docsState === "in_review") {
      etapa = "documentos_em_analise";
      proximo = "Aguardar a validação dos documentos enviados.";
    } else if (docsState === "completed") {
      etapa = "aprovado_aguardando_contratacao";
      proximo = "Aguardar o time da unidade entrar em contato para combinar o início.";
    } else {
      etapa = "aprovado_aguardando_proximas_instrucoes";
      proximo = "Aguardar próximas instruções do time da unidade — aprovado no funil NÃO significa contratado.";
    }
  } else if (hasRejectedTest) {
    etapa = "teste_reprovado";
    proximo = "";
  } else if (hasPendingTest) {
    etapa = "teste_pendente";
    proximo = "Concluir o teste pendente no app.";
  } else if (future) {
    etapa = future.cat === "confirmada" ? "entrevista_confirmada" : "entrevista_agendada";
    proximo = `Comparecer à entrevista em ${fmtDateBR(future.scheduled_date)} às ${fmtTimeBR(future.scheduled_time)}.`;
  } else if (lastPast && !interviewApproved) {
    etapa = "entrevista_realizada_aguardando_decisao";
    proximo = "Aguardar o retorno do time sobre a entrevista.";
  } else if (interviewApproved && docsState === "has_rejected") {
    etapa = "documentos_com_rejeicao";
    proximo = `Reenviar o(s) documento(s) rejeitado(s): ${docRejectedNames.join("; ")}.`;
  } else if (interviewApproved && docsState === "pending") {
    etapa = "documentos_pendentes";
    proximo = `Enviar o(s) documento(s) pendente(s): ${docPendingNames.join(", ")}.`;
  } else if (interviewApproved && docsState === "in_review") {
    etapa = "documentos_em_analise";
    proximo = "Aguardar a validação dos documentos enviados.";
  } else {
    etapa = "em_andamento";
    proximo = "Aguardar próximas instruções pelo app.";
  }

  // Resumo consolidado das 10 verificações (fonte primária para a Sara)
  const ultimaMov = (events && events.length > 0)
    ? `${fmtDateBR(String((events as any[])[0].created_at).slice(0,10))} — ${[(events as any[])[0].event_type, (events as any[])[0].phase_label, (events as any[])[0].to_status].filter(Boolean).join(" / ")}`
    : "(sem registro)";
  const eventosFuturos: string[] = [];
  if (future) eventosFuturos.push(`entrevista ${fmtDateBR(future.scheduled_date)} ${fmtTimeBR(future.scheduled_time)}`);
  if (futureBooking) eventosFuturos.push(`teste presencial ${fmtDateBR(futureBooking.scheduled_date)} ${fmtTimeBR(futureBooking.scheduled_time)}`);
  const pendencias: string[] = [];
  if (docRejectedNames.length) pendencias.push(`documentos rejeitados: ${docRejectedNames.join("; ")}`);
  if (docPendingNames.length) pendencias.push(`documentos pendentes: ${docPendingNames.join(", ")}`);
  if (hasPendingTest) pendencias.push("teste online pendente");
  const acoesCandidato: string[] = [];
  if (futureBooking) acoesCandidato.push(`comparecer ao teste presencial em ${fmtDateBR(futureBooking.scheduled_date)} às ${fmtTimeBR(futureBooking.scheduled_time)}`);
  if (future) acoesCandidato.push(`comparecer à entrevista em ${fmtDateBR(future.scheduled_date)} às ${fmtTimeBR(future.scheduled_time)}`);
  if (docPendingNames.length) acoesCandidato.push(`enviar documentos: ${docPendingNames.join(", ")}`);
  if (docRejectedNames.length) acoesCandidato.push(`corrigir/reenviar documentos: ${docRejectedNames.join("; ")}`);
  if (hasPendingTest) acoesCandidato.push("concluir teste online");

  lines.push("");
  lines.push("===== SITUAÇÃO ATUAL CONSOLIDADA (responda com base aqui) =====");
  lines.push(`1. Etapa atual: ${etapa}`);
  lines.push(`2. Última movimentação: ${ultimaMov}`);
  lines.push(`3. Eventos futuros agendados: ${eventosFuturos.length ? eventosFuturos.join("; ") : "nenhum"}`);
  lines.push(`4. Entrevista agendada: ${future ? `SIM — ${fmtDateBR(future.scheduled_date)} ${fmtTimeBR(future.scheduled_time)}` : "NÃO"}`);
  lines.push(`5. Teste presencial agendado: ${futureBooking ? `SIM — ${fmtDateBR(futureBooking.scheduled_date)} ${fmtTimeBR(futureBooking.scheduled_time)}` : "NÃO"}`);
  lines.push(`6. Documentação pendente: ${(docRejectedNames.length || docPendingNames.length) ? `SIM — ${[...docRejectedNames, ...docPendingNames].join("; ")}` : "NÃO"}`);
  lines.push(`7. Contratação concluída: ${appStatus === "contratado" ? "SIM" : "NÃO"}`);
  lines.push(`8. Reprovação/desistência: ${(interviewRejected || hasRejectedTest || ["desistente","desligado"].includes(appStatus)) ? "SIM" : "NÃO"}`);
  lines.push(`9. Ações esperadas do candidato: ${acoesCandidato.length ? acoesCandidato.join(" | ") : "nenhuma — aguardar"}`);
  lines.push(`10. Próxima etapa: ${proximo || "(aguardar retorno do time)"}`);
  lines.push("===============================================================");
  lines.push(`ETAPA ATUAL: ${etapa}`);
  lines.push(`PRÓXIMO PASSO: ${proximo || "(vazio — pedir para aguardar retorno do time)"}`);

  const derived: Derived = {
    etapa,
    appId: applicationId,
    appStatus,
    docsState,
    docRejectedNames,
    docPendingNames,
    hasPendingTest,
    pendingTestId,
    hasFutureInterview: !!future,
    lastCancelledNoFuture: !!lastCancelled && !future,
  };

  return { contextBlock: lines.join("\n"), derived };
}

// ====== CTAs ======
type Cta = { label: string; to: string; kind: string; primary?: boolean };
type Derived = {
  etapa: string;
  appId: string | null;
  appStatus: string;
  docsState: "none" | "pending" | "in_review" | "completed" | "has_rejected";
  docRejectedNames: string[];
  docPendingNames: string[];
  hasPendingTest: boolean;
  pendingTestId: string | null;
  hasFutureInterview: boolean;
  lastCancelledNoFuture: boolean;
};

function buildCtas(d: Derived): Cta[] {
  const out: Cta[] = [];
  if (!d.appId) return out;
  // Estados terminais → sem CTA
  if (["contratado", "encerrada", "encerrada_desistencia", "entrevista_reprovada", "teste_reprovado"].includes(d.etapa)) return out;
  // Estados de espera → sem CTA
  if (["documentos_em_analise", "aprovado_aguardando_contratacao", "standby", "entrevista_realizada_aguardando_decisao"].includes(d.etapa)) return out;

  // Documentos rejeitados (alta prioridade)
  if (d.etapa === "documentos_com_rejeicao" || d.docsState === "has_rejected") {
    out.push({ label: "Corrigir Documentação", to: `/documentos/${d.appId}`, kind: "documents_fix", primary: true });
  }
  // Documentos pendentes
  else if (d.etapa === "documentos_pendentes" || d.docsState === "pending") {
    out.push({ label: "Enviar Documentos", to: `/documentos/${d.appId}`, kind: "documents_send", primary: true });
  }
  // Teste pendente
  else if (d.etapa === "teste_pendente" || d.hasPendingTest) {
    const to = d.pendingTestId ? `/testes/${d.pendingTestId}` : "/meus-testes";
    out.push({ label: "Iniciar Avaliação", to, kind: "test_start", primary: true });
  }
  // Entrevista futura agendada/confirmada → secundário de remarcação
  else if (["entrevista_agendada", "entrevista_confirmada"].includes(d.etapa) || d.hasFutureInterview) {
    out.push({ label: "Remarcar Entrevista", to: "/candidaturas", kind: "interview_reschedule" });
  }
  // Sem entrevista futura, última foi cancelada → reagendar
  else if (d.lastCancelledNoFuture) {
    out.push({ label: "Escolher Nova Data", to: "/candidaturas", kind: "interview_reschedule", primary: true });
  }
  // Em andamento sem entrevista → agendar
  else if (d.etapa === "em_andamento") {
    out.push({ label: "Acompanhar Candidatura", to: "/candidaturas", kind: "application_open", primary: true });
  }

  return out.slice(0, 2);
}


function buildDeterministicReply(lastBody: string, d: Derived): string | null {
  const normalized = String(lastBody || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.\s]+/g, " ")
    .trim();

  if (!["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "e ai", "eai"].includes(normalized)) {
    return null;
  }

  if (d.docsState === "pending" || d.etapa === "documentos_pendentes") {
    return "Oi! Tô por aqui. Vi que existe uma pendência de documentos no seu processo. Você pode enviar por aqui quando conseguir.";
  }
  if (d.docsState === "has_rejected" || d.etapa === "documentos_com_rejeicao") {
    return "Oi! Tô por aqui. Vi que tem documento precisando de correção no seu processo. Assim que ajustar, o time consegue revisar de novo.";
  }
  if (d.hasPendingTest || d.etapa === "teste_pendente") {
    return "Oi! Tô por aqui. Seu próximo passo é concluir a avaliação pendente para o processo seguir.";
  }
  if (d.hasFutureInterview || ["entrevista_agendada", "entrevista_confirmada"].includes(d.etapa)) {
    return "Oi! Tô por aqui. Sua entrevista está na agenda; qualquer atualização do processo chega por este chat.";
  }
  if (d.etapa === "standby") {
    return "Oi! Tô por aqui. Seu processo está em standby no momento; se surgir uma atualização, o time avisa por este chat.";
  }
  if (["contratado", "encerrada", "encerrada_desistencia"].includes(d.etapa)) {
    return "Oi! Tô por aqui. Esse processo já está encerrado no sistema. Se precisar, o time pode conferir algum detalhe pra você.";
  }

  return "Oi! Tô por aqui acompanhando seu processo. Se quiser, posso te ajudar com a etapa atual ou com o próximo passo.";
}



// ====== FAQ: busca por palavras-chave da última mensagem ======
const FAQ_STOP = new Set([
  "a","o","as","os","de","do","da","dos","das","e","ou","que","qual","quais","quanto",
  "quanta","como","onde","quando","por","para","com","sem","em","um","uma","uns","umas",
  "eu","voce","vc","meu","minha","meus","minhas","ja","ainda","tem","ter","ser","estar",
  "esta","essa","esse","isso","isto","sobre","ai","la","ne","pra","pro","oi","ola"
]);
function faqTokens(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !FAQ_STOP.has(w))
    .slice(0, 8);
}
async function buildFaqBlock(
  supabase: any,
  lastMessage: string,
): Promise<string | null> {
  const tokens = faqTokens(lastMessage);
  if (tokens.length === 0) return null;
  // OR de ilike no question (e tenta tags por overlap se for array)
  const orExpr = tokens.map((t) => `question.ilike.%${t}%,answer.ilike.%${t}%`).join(",");
  const { data: rows } = await supabase
    .from("faq_articles")
    .select("question, answer, tags")
    .eq("status", "published")
    .or(orExpr)
    .limit(8);
  const arr = (rows || []) as any[];
  if (arr.length === 0) return null;
  // Score simples por nº de tokens encontrados em question+answer+tags
  const scored = arr.map((r) => {
    const hay = `${r.question || ""} ${r.answer || ""} ${Array.isArray(r.tags) ? r.tags.join(" ") : ""}`
      .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const hits = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    return { r, hits };
  }).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 3);
  if (scored.length === 0) return null;
  const lines = ["BASE DE CONHECIMENTO (FAQ) — use como fonte autoritativa quando responder ao candidato:"];
  for (const { r } of scored) {
    const q = String(r.question || "").trim();
    const a = String(r.answer || "").trim().slice(0, 600);
    if (q && a) lines.push(`Q: ${q}\nA: ${a}`);
  }
  return lines.join("\n\n");
}

async function safeJson(req: Request) {
  try { return await req.json(); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = await safeJson(req);
  const threadId: string | undefined = body?.thread_id;

  if (!threadId) {
    return new Response(JSON.stringify({ skipped: "no_thread" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1) Flag global
    const { data: gs } = await supabase
      .from("global_settings")
      .select("value")
      .eq("key", "sara_enabled")
      .maybeSingle();
    const globalOn = gs?.value === true || gs?.value === "true";
    if (!globalOn) {
      return new Response(JSON.stringify({ skipped: "sara_disabled_globally" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Thread
    const { data: thread } = await supabase
      .from("conversation_threads")
      .select("id, candidate_id, unit_id, opened_by, status, ai_enabled, persona, application_id")
      .eq("id", threadId)
      .maybeSingle();

    if (!thread || thread.status === "closed" || thread.ai_enabled === false) {
      return new Response(JSON.stringify({ skipped: "thread_not_eligible" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Cadência
    const { data: msgs } = await supabase
      .from("conversation_messages")
      .select("id, sender_id, sender_role, body, author_kind, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(20);

    const ordered = (msgs || []).slice().reverse();
    const last = ordered[ordered.length - 1];
    if (!last || last.sender_role !== "candidato") {
      return new Response(JSON.stringify({ skipped: "last_msg_not_candidate" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lastCandidateTs = new Date(last.created_at).getTime();
    const humanAfter = ordered.some(
      (m: any) => m.sender_role === "recrutador" && m.author_kind === "human" &&
             new Date(m.created_at).getTime() > lastCandidateTs
    );
    if (humanAfter) {
      return new Response(JSON.stringify({ skipped: "human_replied" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = Date.now() - lastCandidateTs;
    if (since < DEBOUNCE_MS) {
      // Aguarda a janela do humano dentro da própria invocação
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS - since));
      // Re-checa humano
      const { data: postCheck1 } = await supabase
        .from("conversation_messages")
        .select("id")
        .eq("thread_id", threadId)
        .gt("created_at", new Date(lastCandidateTs).toISOString())
        .neq("sender_role", "candidato")
        .limit(1);
      if (postCheck1 && postCheck1.length > 0) {
        return new Response(JSON.stringify({ skipped: "human_raced_debounce" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 4) Contexto do candidato/processo
    const { contextBlock, derived } = await buildCandidateContext(
      supabase,
      (thread as any).application_id || null,
      (thread as any).candidate_id,
    );
    const ctas = buildCtas(derived);

    // 4b) FAQ relevante: busca por palavras-chave da última mensagem
    const faqBlock = await buildFaqBlock(supabase, String(last.body || ""));

    const history = ordered.map((m: any) => ({
      role: m.sender_role === "candidato" ? "user" : "assistant",
      content: m.body,
    }));

    let replyBody = sanitizeReply(buildDeterministicReply(String(last.body || ""), derived) || "");
    let aiSource: string | null = null;
    let aiReasoning: string | null = null;

    if (!replyBody) {
      if (!OPENAI_API_KEY) {
        console.error("[sara-reply] OPENAI_API_KEY missing");
        return new Response(JSON.stringify({ skipped: "no_api_key" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const systemMessages: any[] = [
        { role: "system", content: SARA_SYSTEM_PROMPT },
        { role: "system", content: contextBlock },
      ];
      if (faqBlock) systemMessages.push({ role: "system", content: faqBlock });

      const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0.5,
          response_format: { type: "json_object" },
          messages: [
            ...systemMessages,
            ...history,
          ],
        }),
      });

      if (!aiResp.ok) {
        console.error("[sara-reply] AI error", aiResp.status, await aiResp.text().catch(() => ""));
        return new Response(JSON.stringify({ skipped: "ai_error" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const aiData = await aiResp.json();
      const raw: string = aiData?.choices?.[0]?.message?.content?.trim() || "";

      if (!raw || raw.length < 2) {
        return new Response(JSON.stringify({ skipped: "empty_reply" }), { status: 200, headers: corsHeaders });
      }

      // Parse JSON estruturado { raciocinio, fonte, resposta }
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { /* tenta extrair */ }
      if (!parsed || typeof parsed !== "object") {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
      }
      aiSource = parsed?.fonte ? String(parsed.fonte) : null;
      aiReasoning = parsed?.raciocinio ? String(parsed.raciocinio) : null;

      if (aiReasoning) console.log("[sara-reply] raciocinio:", aiReasoning, "| fonte:", aiSource);

      // Extrai SOMENTE o campo "resposta". Quando o parse funcionou (temos um
      // objeto), NUNCA usar o JSON cru como fallback — senão o bloco
      // { raciocinio, fonte, resposta } vaza como mensagem sempre que
      // "resposta" vier vazia (ex.: fonte "sem_dados" nas mensagens sociais).
      let rawAnswer = "";
      if (parsed && typeof parsed === "object") {
        rawAnswer = String(parsed.resposta ?? parsed.answer ?? "").trim();
      } else if (!looksLikeInternalJson(raw)) {
        // Parse falhou totalmente e o texto não parece o nosso JSON interno.
        rawAnswer = raw.trim();
      }

      // Sem resposta real para enviar → suprime (não insere nada). Cobre o caso
      // intencional de "sem_dados" + resposta vazia e qualquer saída malformada.
      if (!rawAnswer) {
        return new Response(JSON.stringify({ skipped: "ai_chose_silence" }), { status: 200, headers: corsHeaders });
      }

      replyBody = sanitizeReply(rawAnswer);
    }
    // Rede de segurança final: nunca deixar o JSON interno vazar como mensagem,
    // qualquer que tenha sido o caminho que gerou replyBody.
    if (!replyBody || looksLikeInternalJson(replyBody)) {
      return new Response(JSON.stringify({ skipped: "sanitized_empty" }), { status: 200, headers: corsHeaders });
    }

    // 5) Re-checa humano E outra mensagem da Sara antes de inserir
    //    Inclui author_kind='ai' pra evitar corrida entre duas invocações
    //    disparadas por mensagens consecutivas do candidato.
    const { data: postCheck } = await supabase
      .from("conversation_messages")
      .select("id, author_kind, sender_role")
      .eq("thread_id", threadId)
      .gt("created_at", new Date(lastCandidateTs).toISOString())
      .neq("sender_role", "candidato")
      .limit(1);
    if (postCheck && postCheck.length > 0) {
      return new Response(JSON.stringify({ skipped: "human_or_ai_raced" }), { status: 200, headers: corsHeaders });
    }

    // 5b) Lock atômico via ai_last_acted_at: se outra invocação já agiu
    //     após lastCandidateTs, aborta. Update condicional serve como CAS.
    //     IMPORTANTE: NÃO usar .or() em UPDATE — o postgrest-js gera uma query
    //     malformada (erro 42703 "column ... does not exist") ao combinar
    //     PATCH + .or(), fazendo TODO lock ser perdido e a Sara parar de
    //     responder. Fazemos o CAS em duas etapas atômicas equivalentes a
    //     (ai_last_acted_at < cutoff) OU (ai_last_acted_at IS NULL). Cada UPDATE
    //     é uma única instrução com trava de linha, então continua livre de corrida.
    const lockNow = new Date().toISOString();
    const lockCutoff = new Date(lastCandidateTs).toISOString();
    let lockRow: { id: string } | null = null;
    let lockErr: unknown = null;
    {
      const r1 = await supabase
        .from("conversation_threads")
        .update({ ai_last_acted_at: lockNow })
        .eq("id", threadId)
        .lt("ai_last_acted_at", lockCutoff)
        .select("id")
        .maybeSingle();
      lockRow = (r1.data as { id: string } | null) ?? null;
      lockErr = r1.error;
      if (!lockErr && !lockRow) {
        // Thread nunca teve ação da IA (ai_last_acted_at IS NULL): tenta adquirir.
        const r2 = await supabase
          .from("conversation_threads")
          .update({ ai_last_acted_at: lockNow })
          .eq("id", threadId)
          .is("ai_last_acted_at", null)
          .select("id")
          .maybeSingle();
        lockRow = (r2.data as { id: string } | null) ?? null;
        lockErr = r2.error;
      }
    }
    if (lockErr || !lockRow) {
      return new Response(JSON.stringify({ skipped: "ai_lock_lost" }), { status: 200, headers: corsHeaders });
    }

    // 6) Insere mensagem da Sara — sender_id NULL (nunca usar opened_by: pode ser o próprio candidato)
    const { error: insertErr } = await supabase.from("conversation_messages").insert({
      thread_id: threadId,
      sender_id: null,
      sender_role: "recrutador",
      body: replyBody,
      author_kind: "ai",
      ai_generated: true,
      ai_model: "openai/gpt-4o",
      ai_prompt_id: "sara_reply@v3",
      sender_mode: "ai",
      persona: "sara",
      tone_profile: "sara_default",
      metadata: {
        ...(ctas.length > 0 ? { ctas } : {}),
        ...(aiSource ? { ai_source: aiSource } : {}),
        ...(aiReasoning ? { ai_reasoning: aiReasoning } : {}),
      },
    } as any);


    if (insertErr) {
      console.error("[sara-reply] insert error", insertErr);
      return new Response(JSON.stringify({ error: "insert_failed", detail: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("conversation_threads")
      .update({ ai_last_acted_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
      .eq("id", threadId);

    // A Sara assumiu e respondeu ao candidato: a conversa foi TRATADA pela IA.
    // Sem isto, cada mensagem que a Sara já respondeu continua marcada como
    // "não lida" para TODOS os recrutadores da unidade (ninguém abre a thread,
    // pois a IA respondeu), inflando o badge do módulo de Mensagens.
    const nowIso = new Date().toISOString();
    try {
      // 1) Mensagens do candidato passam a "lidas" — a IA leu e respondeu.
      await supabase
        .from("conversation_messages")
        .update({ read_at: nowIso })
        .eq("thread_id", threadId)
        .eq("sender_role", "candidato")
        .is("read_at", null);
      // 2) Notificações conversation.new_message destinadas ao recrutador
      //    (sender_role = 'candidato') desta thread são marcadas como lidas.
      //    NÃO tocamos nas notificações do candidato (sender_role = 'recrutador').
      await supabase
        .from("notifications")
        .update({ read_at: nowIso, status: "read" })
        .eq("event_type", "conversation.new_message")
        .is("read_at", null)
        .filter("payload->>thread_id", "eq", threadId)
        .filter("payload->>sender_role", "eq", "candidato");
    } catch (cleanupErr) {
      // Best-effort: falha aqui não deve impedir a resposta já inserida.
      console.error("[sara-reply] mark-read cleanup failed", cleanupErr);
    }

    return new Response(JSON.stringify({ ok: true, replied: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sara-reply] fatal", e);
    return new Response(JSON.stringify({ error: "fatal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
