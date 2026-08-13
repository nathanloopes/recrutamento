import { useEffect, useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  loadOutbox,
  subscribeOutbox,
  flushOutbox,
  retryAction,
  retryAllFailed,
  removeAction,
  type OutboxAction,
} from "@/lib/conversationOutbox";

/**
 * Mantém o outbox de conversas ativo:
 * - Faz flush ao montar, ao voltar online e ao voltar a aba.
 * - Reagenda flush enquanto houver itens pendentes (poll leve).
 * - Após flush, invalida queries relevantes para refletir o estado real.
 */
export function useConversationOutbox() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [items, setItems] = useState<OutboxAction[]>([]);
  const flushingRef = useRef(false);

  const refresh = useCallback(() => {
    if (!user?.id) {
      setItems([]);
      return;
    }
    setItems(loadOutbox(user.id));
  }, [user?.id]);

  const doFlush = useCallback(async () => {
    if (!user?.id || flushingRef.current) return;
    flushingRef.current = true;
    try {
      const result = await flushOutbox(user.id);
      if (result.sent.length || result.marked.length) {
        const threads = new Set<string>();
        result.sent.forEach((s) => threads.add(s.threadId));
        result.marked.forEach((m) => threads.add(m.threadId));
        threads.forEach((tid) => {
          qc.invalidateQueries({ queryKey: ["conv-messages", tid] });
        });
        qc.invalidateQueries({ queryKey: ["conv-threads"] });
        qc.invalidateQueries({ queryKey: ["conv-unread-total"] });
      }
    } finally {
      flushingRef.current = false;
      refresh();
    }
  }, [user?.id, qc, refresh]);

  // sincroniza estado local com storage
  useEffect(() => {
    if (!user?.id) return;
    refresh();
    const unsub = subscribeOutbox(user.id, refresh);
    return unsub;
  }, [user?.id, refresh]);

  // listeners globais
  useEffect(() => {
    if (!user?.id) return;
    const onOnline = () => doFlush();
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") doFlush();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    // flush inicial
    doFlush();
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user?.id, doFlush]);

  // poll leve enquanto houver pendentes
  useEffect(() => {
    if (!user?.id) return;
    const hasPending = items.some((a) => a.status === "pending");
    if (!hasPending) return;
    const t = setInterval(() => {
      if (typeof navigator === "undefined" || navigator.onLine) doFlush();
    }, 5000);
    return () => clearInterval(t);
  }, [items, user?.id, doFlush]);

  const pending = items.filter((a) => a.status === "pending");
  const failed = items.filter((a) => a.status === "failed");

  return {
    pending,
    failed,
    all: items,
    flush: doFlush,
    retry: (actionId: string) => {
      if (!user?.id) return;
      retryAction(user.id, actionId);
      doFlush();
    },
    retryAll: () => {
      if (!user?.id) return;
      retryAllFailed(user.id);
      doFlush();
    },
    discard: (actionId: string) => {
      if (!user?.id) return;
      removeAction(user.id, actionId);
    },
  };
}
