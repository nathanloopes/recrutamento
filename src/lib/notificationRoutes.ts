/**
 * Centralized mapping: event_type + payload → action_url + action_type
 */

import { supabase } from "@/integrations/supabase/client";

type ActionType = "action_required" | "info";

interface NotificationRoute {
  actionUrl: string;
  actionType: ActionType;
}

export function resolveNotificationRoute(
  eventType: string,
  payload: Record<string, string>
): NotificationRoute {
  const applicationId = payload.application_id || "";

  switch (eventType) {
    // ── Ação obrigatória ──
    case "test_assigned":
    case "test_pending_reminder":
      return { actionUrl: "/meus-testes", actionType: "action_required" };

    case "triage_pending_reminder":
      return {
        actionUrl: applicationId ? `/triagem/${applicationId}` : "/candidaturas",
        actionType: "action_required",
      };

    case "documents_requested":
    case "document_rejected":
    case "document_approved":
      return {
        actionUrl: applicationId ? `/documentos/${applicationId}` : "/documentos",
        actionType: "action_required",
      };

    // ── Informativo ──
    case "interview_scheduled":
    case "interview_cancelled":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "candidate_approved":
    case "candidate_rejected":
    case "candidate_standby":
    case "phase_advanced":
    case "hiring_completed":
    case "candidate_hired":
    case "candidate_dismissed":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "faq_resposta":
      return { actionUrl: "/faq", actionType: "info" };

    case "candidate_liked":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "candidate_paused":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "test_submitted":
      return {
        actionUrl: payload.unit_job_id
          ? `/admin/vagas/${payload.unit_job_id}/candidatos`
          : "/admin/vagas",
        actionType: "action_required",
      };

    case "new_application":
      return {
        actionUrl: payload.unit_job_id
          ? `/admin/vagas/${payload.unit_job_id}/candidatos`
          : "/admin/vagas",
        actionType: "action_required",
      };

    case "candidate_withdrawn":
      return {
        actionUrl: payload.unit_job_id
          ? `/admin/vagas/${payload.unit_job_id}/candidatos`
          : "/admin/vagas",
        actionType: "action_required",
      };

    case "reschedule_requested":
      return { actionUrl: "/admin/agendamento", actionType: "action_required" };

    case "document_uploaded":
      return { actionUrl: "/admin/documentacao", actionType: "action_required" };

    case "talent_pool_auto_added":
      return { actionUrl: "/admin/banco-de-talentos", actionType: "info" };

    case "interview_reminder_24h":
    case "interview_reminder_2h":
    case "interview_reminder_15min":
    case "interview_reminder_1h":
    case "interview_reminder_10min":
    case "interview_reminder":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "automation_reminder":
      return { actionUrl: "/notificacoes", actionType: "info" };

    case "migration_completed":
      return { actionUrl: "/admin/migracoes", actionType: "info" };

    case "job_closed":
      return { actionUrl: "/admin/vagas", actionType: "info" };

    case "job_request_created":
      return { actionUrl: "/admin/vagas", actionType: "action_required" };

    case "job_request_em_analise":
    case "job_request_aprovada":
    case "job_request_reprovada":
      return { actionUrl: "/admin/vagas", actionType: "info" };

    case "address_change":
      return { actionUrl: "/admin/candidatos", actionType: "info" };

    case "talent_invite_sent":
      return { actionUrl: "/banco-de-talentos", actionType: "action_required" };

    case "talent_invite_accepted":
    case "talent_invite_declined":
      return {
        actionUrl: payload.unit_job_id
          ? `/admin/vagas/${payload.unit_job_id}/candidatos`
          : "/admin/vagas",
        actionType: "info",
      };

    case "interview_reschedule_requested":
      return { actionUrl: "/candidaturas", actionType: "action_required" };

    case "voice_interview_started":
    case "voice_interview_failed":
    case "interview_approved":
    case "interview_talent_pool":
    case "interview_escalated":
    case "interview_completed":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "interview_escalated_admin":
      return { actionUrl: "/admin/entrevistas-ia", actionType: "action_required" };

    case "interview_no_show":
      return { actionUrl: "/admin/agendamento", actionType: "info" };

    case "interview_rescheduled":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "interview_pending_approval":
      return { actionUrl: "/admin/agendamento", actionType: "action_required" };

    case "corporate_job_created":
    case "cargo_alterado":
      return { actionUrl: "/admin/vagas", actionType: "info" };

    case "automation_failure":
      return { actionUrl: "/admin/configuracoes", actionType: "action_required" };

    case "unit_job_stalled":
    case "unit_high_rejection":
    case "unit_high_withdrawal":
      return { actionUrl: "/admin/vagas", actionType: "action_required" };

    case "weekly_monitoring_report":
      return { actionUrl: "/admin", actionType: "info" };

    case "candidato_apto_no_raio":
      return { actionUrl: "/admin/vagas", actionType: "info" };

    case "candidate_hired":
      return { actionUrl: "/candidaturas", actionType: "info" };

    case "document_deadline_reminder":
      return {
        actionUrl: applicationId ? `/documentos/${applicationId}` : "/documentos",
        actionType: "action_required",
      };

    case "conversation.new_message": {
      const threadId = (payload as any).thread_id || "";
      const senderRole = (payload as any).sender_role;
      // sender_role indica QUEM enviou; o destinatário é o oposto.
      // Se candidato enviou → destinatário é recrutador (rota admin).
      // Se recrutador enviou → destinatário é candidato.
      if (senderRole === "candidato") {
        return { actionUrl: threadId ? `/admin/mensagens/${threadId}` : "/admin/mensagens", actionType: "action_required" };
      }
      return { actionUrl: threadId ? `/mensagens/${threadId}` : "/mensagens", actionType: "action_required" };
    }

    default:
      return { actionUrl: "/notificacoes", actionType: "info" };
  }
}

/**
 * Returns deduplicated admin recipient IDs for notifications.
 *
 * - "admin" role: receives ALL notifications regardless of unit
 * - Other admin roles: only if they match the unit_id or have scope_access="rede"
 */
export async function getAdminRecipientIds(unitId?: string | null): Promise<string[]> {
  // Resolved server-side via SECURITY DEFINER RPC to avoid exposing user_roles to clients.
  const { data, error } = await supabase.rpc("get_admin_recipient_ids" as any, {
    _unit_id: unitId ?? null,
  });
  if (error) {
    console.warn("[getAdminRecipientIds] RPC error:", error.message);
    return [];
  }
  const ids = Array.isArray(data)
    ? (data as any[]).map((r) => (typeof r === "string" ? r : r?.user_id ?? r))
    : [];
  return [...new Set(ids.filter(Boolean) as string[])];
}
