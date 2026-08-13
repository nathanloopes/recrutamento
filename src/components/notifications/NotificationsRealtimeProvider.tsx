import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useServiceWorkerMessages } from "@/hooks/useServiceWorkerMessages";
import { showLocalBanner } from "@/lib/foregroundNotifications";
import { isRecoveryMode } from "@/lib/recoveryMode";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Provider global de sincronização de notificações em tempo real.
 *
 * Responsabilidades:
 *  - Mantém UM único canal Realtime ativo enquanto houver usuário logado.
 *  - Escuta INSERT/UPDATE/DELETE em `notifications` filtrado por recipient_id.
 *  - Reinvalida caches do React Query a cada evento → badge/lista atualizam
 *    em qualquer tela, sem precisar abrir o módulo de notificações.
 *  - Reconecta ao voltar do background (visibilitychange), ao recuperar rede
 *    (online) e no foco da janela. Também invalida queries nesses eventos
 *    para capturar notificações que chegaram enquanto o WebSocket estava
 *    dormindo.
 *  - Escuta mensagens do Service Worker (push recebido com app em background).
 *
 * Deve ser montado UMA vez, acima das rotas, dentro do AuthProvider.
 */
export function NotificationsRealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Listener de mensagens do Service Worker (push em background)
  useServiceWorkerMessages();

  useEffect(() => {
    // Não assinar Realtime se estiver em recuperação de senha — sessão é
    // temporária e não autoriza assinatura de canais do usuário.
    if (!user?.id || isRecoveryMode()) {
      // Se deslogou ou entrou em recuperação, limpa canal existente.
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    const userId = user.id;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["my_notifications", userId] });
      qc.invalidateQueries({ queryKey: ["unread_count", userId] });
      qc.invalidateQueries({ queryKey: ["module_badges", userId] });
    };

    const subscribe = () => {
      // Reaproveita canal se já existir (ex: StrictMode double-effect, remount).
      if (channelRef.current) return;

      // console.log("[NotifRealtime] subscribing for user", userId);
      const channel = supabase
        .channel(`notifications-global:${userId}`)
        .on(
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${userId}`,
          },
          (payload: any) => {
            // console.log("[NotifRealtime] event received:", payload?.eventType, payload?.new ?? payload?.old);
            invalidate();

            // Banner local em foreground: só para INSERT de notificação
            // destinada a este usuário e que ainda não foi lida.
            if (
              payload?.eventType === "INSERT" &&
              payload?.new?.recipient_id === userId &&
              !payload?.new?.read_at
            ) {
              showLocalBanner({
                title: payload.new.title,
                body: payload.new.body,
                url: payload.new.action_url,
                tag: payload.new.id,
              }).catch((err) => console.warn("[NotifRealtime] banner error:", err));
            }
          }
        )
        .subscribe((status) => {
          // IMPORTANTE: não chamar removeChannel aqui dentro — causa recursão
          // (removeChannel dispara CLOSED que dispara este callback de novo).
          // A reconexão é feita pelos handlers de visibilitychange/online/focus.
          // console.log("[NotifRealtime] channel status:", status);
        });

      channelRef.current = channel;
    };

    subscribe();

    // ── Reconexão e sync ao sair do background / voltar rede ──
    // O cliente Supabase Realtime reconecta o WebSocket automaticamente,
    // então aqui só precisamos invalidar queries para puxar o que chegou
    // enquanto a aba estava em background.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        invalidate();
      }
    };

    const handleOnline = () => {
      invalidate();
    };

    const handleFocus = () => {
      invalidate();
    };

    // Mudança de role: encerra canal antigo, limpa caches e religa.
    const handleRoleChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.userId !== userId) return;
      // console.log("[NotifRealtime] role changed — resubscribing channel");
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      invalidate();
      subscribe();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("auth:role-changed", handleRoleChanged as EventListener);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("auth:role-changed", handleRoleChanged as EventListener);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, qc]);

  return <>{children}</>;
}
