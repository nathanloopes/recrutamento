import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Maps each admin module (by route slug) to the notification event_types that belong to it.
 */
const MODULE_EVENT_MAP: Record<string, string[]> = {
  vagas: [
    "new_application",
    "candidate_withdrawn",
    "test_submitted",
    "job_closed",
    "job_request_created",
    "job_request_em_analise",
    "job_request_aprovada",
    "job_request_reprovada",
  ],
  documentacao: [
    "document_uploaded",
    "documents_requested",
    "document_rejected",
    "document_approved",
    "hiring_completed",
  ],
  agendamento: [
    "reschedule_requested",
    "interview_scheduled",
    "interview_cancelled",
    "interview_reminder_24h",
    "interview_reminder_2h",
    "interview_reminder_1h",
    "interview_reminder_15min",
    "interview_reminder_10min",
    "interview_reminder",
  ],
  testes: ["test_assigned"],
  faq: ["faq_resposta"],
  mensagens: ["conversation.new_message"],
  "banco-de-talentos": ["talent_pool_auto_added", "candidate_liked", "talent_invite_sent", "talent_invite_accepted", "talent_invite_declined"],
  migracoes: ["migration_completed"],
  logs: ["address_change"],
};

/** Reverse map: event_type → module slug */
const EVENT_TO_MODULE: Record<string, string> = {};
for (const [mod, events] of Object.entries(MODULE_EVENT_MAP)) {
  for (const evt of events) {
    EVENT_TO_MODULE[evt] = mod;
  }
}

/** All event types that are mapped to a module */
const ALL_MAPPED_EVENTS = Object.values(MODULE_EVENT_MAP).flat();

export type ModuleBadgeCounts = Record<string, number>;

/**
 * Returns a map of module slug → unread notification count.
 * Only includes modules with count > 0.
 * Refetches every 30s and is invalidated by realtime subscription.
 */
export function useModuleBadges(): { data: ModuleBadgeCounts; isLoading: boolean } {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["module_badges", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications" as any)
        .select("event_type")
        .eq("recipient_id", user!.id)
        .is("read_at", null)
        .in("status", ["sent", "pending", "failed", "unread"])
        .in("event_type", ALL_MAPPED_EVENTS);
      if (error) throw error;

      const counts: ModuleBadgeCounts = {};
      for (const row of (data as any[]) || []) {
        const mod = EVENT_TO_MODULE[row.event_type];
        if (mod) {
          counts[mod] = (counts[mod] || 0) + 1;
        }
      }
      return counts;
    },
    refetchInterval: 30000,
  });

  return { data: query.data || {}, isLoading: query.isLoading };
}

/**
 * Returns the badge count for a specific module.
 */
export function useModuleBadgeCount(moduleSlug: string): number {
  const { data } = useModuleBadges();
  return data[moduleSlug] || 0;
}

/**
 * Marks all unread notifications for a given module as read.
 */
export function useMarkModuleAsRead() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (moduleSlug: string) => {
      const events = MODULE_EVENT_MAP[moduleSlug];
      if (!events || events.length === 0 || !user?.id) return;

      const { error } = await supabase
        .from("notifications" as any)
        .update({ read_at: new Date().toISOString(), status: "read" } as any)
        .eq("recipient_id", user.id)
        .is("read_at", null)
        .in("event_type", events);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["module_badges"] });
      qc.invalidateQueries({ queryKey: ["unread_count"] });
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
    },
  });
}

/**
 * @deprecated REMOVIDO INTENCIONALMENTE.
 *
 * Notificações NUNCA devem ser marcadas como lidas automaticamente em
 * route change, app start, fetch ou sync de sessão. A marcação só pode
 * acontecer no clique explícito do usuário (`useMarkAsRead` em
 * NotificationBell / Notifications / AdminNotifications) ou via botão
 * manual "Marcar todas como lidas" (`useMarkAllAsRead` / `useMarkModuleAsRead`).
 *
 * Não reintroduza `useAutoMarkModuleRead` — quebra a regra de só marcar
 * como lida com interação real.
 */
export function useAutoMarkModuleRead(): void {
  // intencionalmente vazio — ver JSDoc acima
}
