import { supabase } from "@/integrations/supabase/client";

// Mudança de status da VAGA → notifica APENAS os candidatos vinculados àquela
// vaga específica (unit_job_id), respeitando a unidade daquela vaga. NÃO é por
// cargo: dois "Vendedor" em unidades diferentes são unit_jobs distintos.
//
// Reutiliza 100% o mecanismo de templates existente: insere 1 linha em
// `notifications` e chama send-notification-cascade — que entrega o canal
// default (push) e, quando o WhatsApp está habilitado e existe um
// notification_template ativo para (event_type, whatsapp), dispara o template
// Meta `mudanca_status_vaga` via send-whatsapp. Nenhuma função/infra de envio é
// alterada aqui; a única diferença é o evento que inicia o envio.
//
// Mantém os MESMOS event_type por status já usados hoje (job_paused/job_filled/
// job_closed) para preservar rótulos (notificationLabels), rotas
// (notificationRoutes) e badges (useModuleBadges) do app. Os 3 apontam para o
// mesmo template Meta.
//
// Best-effort: nunca lança — falha de notificação não bloqueia a troca de status.

export type JobStatusChange = "pausada" | "preenchida" | "encerrada";

// eventType = mantém o evento por status (compatível com os fluxos atuais).
// status_label = descrição amigável; status_message = mensagem complementar
// ({{4}} do template — string vazia quando não há mensagem específica).
// pushTitle/pushBody preservam o conteúdo do push que já era enviado hoje.
const STATUS_COPY: Record<
  JobStatusChange,
  {
    eventType: string;
    label: string;
    message: string;
    pushTitle: string;
    pushBody: string;
    actionUrl: string;
  }
> = {
  pausada: {
    eventType: "job_paused",
    label: "Pausada",
    message: "A vaga foi pausada temporariamente; avisaremos quando houver novidades.",
    pushTitle: "Vaga pausada",
    pushBody:
      "A vaga para a qual você se candidatou foi pausada temporariamente. Avisaremos assim que houver novidades.",
    actionUrl: "/candidaturas",
  },
  preenchida: {
    eventType: "job_filled",
    label: "Preenchida",
    message: "Mantenha-se no Banco de Talentos para futuras oportunidades.",
    pushTitle: "Vaga preenchida",
    pushBody:
      "A vaga para a qual você se candidatou foi preenchida. Você pode se manter disponível no Banco de Talentos para futuras oportunidades.",
    actionUrl: "/banco-talentos",
  },
  encerrada: {
    eventType: "job_closed",
    label: "Encerrada",
    message: "Você pode se manter no Banco de Talentos para futuras oportunidades.",
    pushTitle: "Processo encerrado",
    pushBody:
      "A vaga para a qual você se candidatou foi encerrada. Você pode se manter disponível no Banco de Talentos para futuras oportunidades.",
    actionUrl: "/banco-talentos",
  },
};

const ACTIVE_APP_STATUSES = ["em_andamento", "standby", "aprovado"];

export async function notifyJobStatusChange(
  unitJobId: string,
  newStatus: JobStatusChange,
): Promise<void> {
  try {
    const copy = STATUS_COPY[newStatus];
    if (!copy) return;

    // Título da vaga (job_title) — via relação unit_jobs → jobs.
    const { data: uj } = await supabase
      .from("unit_jobs")
      .select("jobs(title)")
      .eq("id", unitJobId)
      .maybeSingle();
    const jobTitle = (uj as any)?.jobs?.title || "a vaga";

    // Candidaturas ATIVAS desta vaga específica (filtro por unit_job_id).
    const { data: apps } = await supabase
      .from("applications")
      .select("id, candidate_id")
      .eq("unit_job_id", unitJobId)
      .in("status", ACTIVE_APP_STATUSES);
    if (!apps || apps.length === 0) return;

    // Nome de cada candidato (candidate_name) — recipient_id == profiles.id.
    const candidateIds = [...new Set(apps.map((a) => a.candidate_id).filter(Boolean))];
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", candidateIds);
    const nameById = new Map((profs || []).map((p: any) => [p.id, p.full_name]));

    // Uma notificação por candidato, com as variáveis do template no payload.
    const rows = apps.map((app) => ({
      event_type: copy.eventType,
      recipient_id: app.candidate_id,
      channel: "push",
      title: copy.pushTitle,
      body: copy.pushBody,
      // "pending" (não "sent"): o send-notification-cascade usa notifications
      // com status="sent" nos últimos minutos para checar cooldown/rate-limit
      // (STEP 3/4). Inserir já como "sent" fazia a própria notificação se
      // autobloquear ("cooldown"), impedindo push E WhatsApp — sobrava só o
      // fallback in-app. O cascade marca "sent" ao final da entrega.
      status: "pending",
      action_type: "info",
      action_url: copy.actionUrl,
      payload: {
        candidate_name: nameById.get(app.candidate_id) || "Candidato",
        job_title: jobTitle,
        status_label: copy.label,
        status_message: copy.message,
        unit_job_id: unitJobId,
        application_id: app.id,
        new_status: newStatus,
      },
    }));

    // Apenas INSERE. O dispatch (push + template WhatsApp via
    // send-notification-cascade) é feito automaticamente pelo trigger de banco
    // `notifications_dispatch_cascade` na inserção — igual aos demais fluxos
    // (automationEngine, interviewOrchestrator). NÃO chamar o cascade aqui:
    // chamar de novo dispara a mensagem em DOBRO (trigger + chamada explícita).
    const { error: insErr } = await supabase
      .from("notifications")
      .insert(rows as any);
    if (insErr) {
      console.error("[jobStatusNotifications] falha ao inserir notificações", insErr);
    }
  } catch (err) {
    console.error("[jobStatusNotifications] erro", err);
  }
}
