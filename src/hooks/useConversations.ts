import { useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { enqueueSend, enqueueMarkRead, flushOutbox, loadOutbox, removeActions, subscribeOutbox } from "@/lib/conversationOutbox";
import { createCoalescer, type Coalescer } from "@/lib/invalidationCoalescer";

export type ConversationThread = {
  id: string;
  application_id: string;
  candidate_id: string;
  unit_id: string;
  opened_by: string;
  status: "open" | "closed";
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: "candidato" | "recrutador";
  body: string;
  read_at: string | null;
  created_at: string;
  client_action_id?: string | null;
  // Persona Sara — interno (não exibido ao candidato)
  author_kind?: "human" | "ai";
  ai_generated?: boolean;
  ai_model?: string | null;
  ai_prompt_id?: string | null;
  metadata?: { ctas?: Array<{ label: string; to: string; kind?: string; primary?: boolean }> } | null;
  // Campos client-only (outbox)
  pending?: boolean;
  failed?: boolean;
  outboxActionId?: string;
};


const processedMessageIds = new Set<string>();

function markMessageProcessed(id?: string | null) {
  if (!id || id.startsWith("temp_")) return;
  processedMessageIds.add(id);
  if (processedMessageIds.size > 5_000) {
    for (const key of Array.from(processedMessageIds).slice(0, 1_000)) processedMessageIds.delete(key);
  }
}

function isOptimisticMessage(m: ConversationMessage) {
  return Boolean(
    m.outboxActionId ||
      m.pending ||
      m.failed ||
      (typeof m.id === "string" && m.id.startsWith("temp_"))
  );
}

// Divide um array em chunks — usado para .in("thread_id", ids) quando a lista pode ser grande
// (URLs muito longas retornam 400 no PostgREST).
const IN_CHUNK_SIZE = 100;
function chunk<T>(arr: T[], size = IN_CHUNK_SIZE): T[][] {
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isSameResolvedAttempt(real: ConversationMessage, optimistic: ConversationMessage) {
  if (real.thread_id !== optimistic.thread_id || real.sender_id !== optimistic.sender_id || real.body !== optimistic.body) return false;
  // Match forte por client_action_id — evita colapsar mensagens iguais enviadas em sequência.
  return Boolean(optimistic.client_action_id && real.client_action_id && real.client_action_id === optimistic.client_action_id);
}

function hasSameMessageIdentity(a: ConversationMessage, b: ConversationMessage) {
  return a.id === b.id || Boolean(a.client_action_id && b.client_action_id && a.client_action_id === b.client_action_id);
}

function dedupeConversationMessages(messages: ConversationMessage[]) {
  const out: ConversationMessage[] = [];
  for (const msg of messages) {
    const idx = out.findIndex((m) => hasSameMessageIdentity(m, msg));
    if (idx === -1) {
      out.push(msg);
      continue;
    }
    const current = out[idx];
    out[idx] = isOptimisticMessage(current) && !isOptimisticMessage(msg) ? msg : current;
  }
  return out;
}

function removeOptimisticDuplicates(prev: ConversationMessage[], real: ConversationMessage) {
  return dedupeConversationMessages(prev.filter((m) => m.id === real.id || !isOptimisticMessage(m) || !isSameResolvedAttempt(real, m)));
}

// === Candidate inbox: list of threads with last message + unread count ===
export function useCandidateThreads() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["conv-threads", "candidate", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: threads, error } = await supabase
        .from("conversation_threads")
        .select(`
          *,
          applications:application_id (
            id, status,
            unit_jobs!inner (
              id, units (id, name, city, state),
              jobs (id, title)
            )
          )
        `)
        .eq("candidate_id", user!.id)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;

      const threadIds = (threads || []).map((t: any) => t.id);
      if (threadIds.length === 0) return [] as any[];

      const { data: lastMsgs } = await supabase
        .from("conversation_messages")
        .select("thread_id, body, sender_role, created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false });

      const { data: unread } = await supabase
        .from("conversation_messages")
        .select("thread_id")
        .in("thread_id", threadIds)
        .eq("sender_role", "recrutador")
        .is("read_at", null);

      const lastByThread: Record<string, any> = {};
      for (const m of lastMsgs || []) {
        if (!lastByThread[m.thread_id]) lastByThread[m.thread_id] = m;
      }
      const unreadByThread: Record<string, number> = {};
      for (const u of unread || []) {
        unreadByThread[u.thread_id] = (unreadByThread[u.thread_id] || 0) + 1;
      }

      return (threads || []).map((t: any) => ({
        ...t,
        lastMessage: lastByThread[t.id] || null,
        unreadCount: unreadByThread[t.id] || 0,
        jobTitle: t.applications?.unit_jobs?.jobs?.title || "Vaga",
        unitName: t.applications?.unit_jobs?.units?.name || "Unidade",
      }));
    },
    refetchOnWindowFocus: false,
  });
}

// === Single thread detail ===
export function useThread(threadId?: string) {
  return useQuery({
    queryKey: ["conv-thread", threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_threads")
        .select(`*, applications:application_id ( id, status, unit_jobs!inner ( units (id, name, city, state), jobs (id, title) ) )`)
        .eq("id", threadId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return data as any;
      let candidateName = "Candidato";
      if ((data as any).candidate_id) {
        const { data: prof } = await (supabase as any)
          .from("profiles")
          .select("full_name")
          .eq("id", (data as any).candidate_id)
          .maybeSingle();
        if (prof?.full_name) candidateName = prof.full_name;
      }
      return { ...(data as any), candidateName } as any;
    },
    refetchOnWindowFocus: false,
  });
}

// Helper: cria canal Realtime com reconexão automática + backoff exponencial
// `attach` recebe um channel novo, registra os listeners e retorna o channel.
// `onResync` é chamado após cada (re)conexão bem-sucedida (útil para invalidar cache).
function createReconnectingChannel(opts: {
  baseName: string;
  attach: (channel: ReturnType<typeof supabase.channel>) => ReturnType<typeof supabase.channel>;
  onResync?: () => void;
}) {
  let cancelled = false;
  let attempt = 0;
  let current: ReturnType<typeof supabase.channel> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let isFirstSubscribe = true;

  const clearTimers = () => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
  };

  const teardownCurrent = () => {
    if (current) {
      try { current.unsubscribe(); } catch {}
      try { supabase.removeChannel(current); } catch {}
      current = null;
    }
  };

  const scheduleReconnect = (immediate = false) => {
    if (cancelled) return;
    if (retryTimer) return; // já agendado
    const delay = immediate
      ? 0
      : Math.min(30_000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
    attempt = immediate ? 0 : attempt + 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (cancelled) return;
      teardownCurrent();
      connect();
    }, delay);
  };

  const connect = () => {
    if (cancelled) return;
    const nonce = Math.random().toString(36).slice(2);
    const channel = supabase.channel(`${opts.baseName}:${nonce}`);
    current = opts.attach(channel);
    current.subscribe((status) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") {
        // após 5s estável, zera contador
        if (stableTimer) clearTimeout(stableTimer);
        stableTimer = setTimeout(() => { attempt = 0; }, 5000);
        // só dispara resync após reconexão (não na 1ª subscribe inicial)
        if (!isFirstSubscribe && opts.onResync) opts.onResync();
        isFirstSubscribe = false;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
        scheduleReconnect();
      }
    });
  };

  const onOnline = () => scheduleReconnect(true);
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      scheduleReconnect(true);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  connect();

  return () => {
    cancelled = true;
    clearTimers();
    teardownCurrent();
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };
}

// === Messages of a thread + realtime ===
export function useThreadMessages(threadId?: string) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["conv-messages", threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_messages")
        .select("*")
        .eq("thread_id", threadId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const messages = dedupeConversationMessages((data || []) as ConversationMessage[]);
      messages.forEach((m) => markMessageProcessed(m.id));
      return messages;
    },
    refetchOnWindowFocus: false,
  });

  // Realtime subscription com reconexão automática + coalescer de invalidações
  const qcRef = useRef(qc);
  qcRef.current = qc;
  const coalescerRef = useRef<Coalescer | null>(null);
  if (!coalescerRef.current) {
    coalescerRef.current = createCoalescer({ qc, label: "conv-msgs" });
  }
  useEffect(() => {
    if (!threadId) return;
    const cleanup = createReconnectingChannel({
      baseName: `conv-msgs:${threadId}`,
      attach: (channel) =>
        channel.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "conversation_messages", filter: `thread_id=eq.${threadId}` },
          (payload) => {
            const newMsg = payload.new as ConversationMessage;
            const processed = processedMessageIds.has(newMsg.id);
            console.info("[conv-ui] realtime_insert", {
              threadId,
              realId: newMsg.id,
              clientActionId: newMsg.client_action_id,
              senderId: newMsg.sender_id,
              body: newMsg.body,
              createdAt: newMsg.created_at,
              processed,
            });
            if (processed) {
              console.info("[conv-ui] realtime_ignore_processed", { threadId, realId: newMsg.id });
              return;
            }
            qcRef.current.setQueryData<ConversationMessage[]>(["conv-messages", threadId], (prev) => {
              if (!prev?.length) {
                markMessageProcessed(newMsg.id);
                return [newMsg];
              }
              const exactIdx = prev.findIndex((m) => hasSameMessageIdentity(m, newMsg));
              if (exactIdx !== -1) {
                markMessageProcessed(newMsg.id);
                if (isOptimisticMessage(prev[exactIdx])) {
                  console.info("[conv-ui] realtime_replace_existing_optimistic", { threadId, realId: newMsg.id, tempId: prev[exactIdx].id, clientActionId: newMsg.client_action_id });
                  const next = prev.slice();
                  next[exactIdx] = newMsg;
                  return removeOptimisticDuplicates(next, newMsg);
                }
                console.info("[conv-ui] realtime_ignore_existing", { threadId, realId: newMsg.id, clientActionId: newMsg.client_action_id });
                return dedupeConversationMessages(prev);
              }
              const tempIdx = prev.findIndex((m) => isOptimisticMessage(m) && isSameResolvedAttempt(newMsg, m));
              if (tempIdx !== -1) {
                console.info("[conv-ui] realtime_swap_temp", {
                  threadId,
                  realId: newMsg.id,
                  tempId: prev[tempIdx].id,
                  outboxActionId: prev[tempIdx].outboxActionId,
                  clientActionId: newMsg.client_action_id,
                  body: newMsg.body,
                });
                markMessageProcessed(newMsg.id);
                const next = prev.slice();
                next[tempIdx] = newMsg;
                return removeOptimisticDuplicates(next, newMsg);
              }
              if (newMsg.sender_id === user?.id && prev.some((m) => m.sender_id === user.id && m.thread_id === newMsg.thread_id)) {
                markMessageProcessed(newMsg.id);
                console.info("[conv-ui] realtime_ignore_own_without_local_match", { threadId, realId: newMsg.id, clientActionId: newMsg.client_action_id });
                return prev;
              }
              console.info("[conv-ui] realtime_append_real", { threadId, realId: newMsg.id, body: newMsg.body });
              markMessageProcessed(newMsg.id);
              return dedupeConversationMessages([...prev, newMsg]);
            });
            // throttle: invalidações de listas/contagem em rajada
            coalescerRef.current?.schedule(["conv-threads"]);
            coalescerRef.current?.schedule(["conv-unread-total"]);
          }
        ),
      onResync: () => {
        // re-sincronização: prioriza mensagens do thread aberto
        coalescerRef.current?.schedule(["conv-messages", threadId], { immediate: true });
        coalescerRef.current?.schedule(["conv-threads"]);
        coalescerRef.current?.schedule(["conv-unread-total"]);
      },
    });
    return () => {
      cleanup();
    };
  }, [threadId, user?.id]);

  // dispose do coalescer no unmount (após cleanup do canal)
  useEffect(() => () => { coalescerRef.current?.dispose(); coalescerRef.current = null; }, []);

  // Sincroniza flags pending/failed das mensagens otimistas com o estado do outbox.
  // Também REIDRATA mensagens não enviadas a partir do outbox quando elas não
  // estão presentes no cache (ex.: usuário saiu da conversa e voltou — o fetch
  // do servidor não traz pending/failed; sem isso, o usuário perde a referência
  // do que digitou).
  useEffect(() => {
    if (!threadId || !user?.id) return;
    const sync = () => {
      const items = loadOutbox(user.id);
      const sendsForThread = items.filter(
        (a) => a.kind === "send" && a.threadId === threadId
      ) as Array<Extract<ReturnType<typeof loadOutbox>[number], { kind: "send" }>>;
      const staleActionIds: string[] = [];
      const byActionId = new Map<string, "pending" | "failed">();
      for (const a of sendsForThread) byActionId.set(a.id, a.status);

      qcRef.current.setQueryData<ConversationMessage[]>(["conv-messages", threadId], (prev) => {
        const base = prev ? prev.slice() : [];

        // 1) Atualiza flags das otimistas já presentes
        let changed = false;
        for (let i = 0; i < base.length; i++) {
          const m = base[i];
          if (!m.outboxActionId) continue;
          const st = byActionId.get(m.outboxActionId);
          if (!st) {
            // Otimista órfã: só remove se houver mensagem real com MESMO client_action_id.
            const alreadySent = !!m.client_action_id && base.some(
              (real) =>
                !isOptimisticMessage(real) &&
                real.client_action_id === m.client_action_id
            );
            if (alreadySent) {
              base.splice(i, 1);
              i--;
              changed = true;
            }
            continue;
          }
          const failed = st === "failed";
          const pending = st === "pending";
          if (m.failed !== failed || m.pending !== pending) {
            base[i] = { ...m, failed, pending };
            changed = true;
          }
        }

        // 2) Reidrata otimistas que sumiram do cache (saiu e voltou da tela)
        const presentActionIds = new Set(
          base.map((m) => m.outboxActionId).filter(Boolean) as string[]
        );
        for (const a of sendsForThread) {
          if (presentActionIds.has(a.id)) continue;
          // Stale APENAS quando a mensagem real com o mesmo client_action_id já existe.
          // Nunca por content+window — várias mensagens iguais ("oi") devem coexistir.
          const alreadySent = !!a.clientActionId && base.some(
            (m) => !isOptimisticMessage(m) && m.client_action_id === a.clientActionId
          );
          if (alreadySent) {
            staleActionIds.push(a.id);
            continue;
          }
          base.push({
            id: a.tempId,
            thread_id: threadId,
            sender_id: a.senderId,
            sender_role: a.senderRole,
            body: a.body,
            read_at: null,
            created_at: new Date(a.createdAt).toISOString(),
            client_action_id: a.clientActionId || null,
            pending: a.status === "pending",
            failed: a.status === "failed",
            outboxActionId: a.id,
          });
          changed = true;
        }


        if (!changed) return prev;
        // mantém ordenação cronológica
        base.sort(
          (x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime()
        );
        return dedupeConversationMessages(base);
      });
        if (staleActionIds.length) removeActions(user.id, staleActionIds);
    };
    sync();
    const unsub = subscribeOutbox(user.id, sync);
    return unsub;
  }, [threadId, user?.id, query.data]);

  // Mark incoming as read whenever messages change (via outbox para suporte offline)
  useEffect(() => {
    if (!threadId || !user?.id || !query.data) return;
    const unreadIds = query.data
      .filter((m) => !m.read_at && m.sender_id !== user.id && !m.pending && !m.failed)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    // Optimistic: zera badge imediatamente subtraindo as mensagens marcadas
    qc.setQueriesData({ queryKey: ["conv-unread-total"] }, (old: any) => {
      const n = typeof old === "number" ? old : 0;
      return Math.max(0, n - unreadIds.length);
    });
    // Optimistic: marca local como lido para não re-enfileirar
    qc.setQueryData<ConversationMessage[]>(["conv-messages", threadId], (prev) => {
      if (!prev) return prev;
      const set = new Set(unreadIds);
      const stamp = new Date().toISOString();
      return prev.map((m) => (set.has(m.id) ? { ...m, read_at: stamp } : m));
    });
    enqueueMarkRead(user.id, { threadId, messageIds: unreadIds });
    flushOutbox(user.id).then(() => {
      qc.invalidateQueries({ queryKey: ["conv-unread-total"] });
      qc.invalidateQueries({ queryKey: ["conv-threads"] });
    });
  }, [threadId, user?.id, query.data, qc]);

  // Marcação de notificações conversation.new_message como lidas é feita
  // por useMarkConversationNotificationsRead, chamado nas páginas de Conversation.


  return query;
}

// === Send message (offline-first via outbox) ===
export function useSendMessage(threadId?: string) {
  const qc = useQueryClient();
  const { user, hasRole, unitIds } = useAuth();
  return useMutation({
    mutationFn: async (body: string) => {
      if (!threadId || !user?.id) throw new Error("Sessão inválida");
      const trimmed = body.trim();
      if (!trimmed) throw new Error("Mensagem vazia");

      // Carrega thread (cache → fallback DB) para validar permissão antes de enfileirar
      let thread = qc.getQueryData<ConversationThread>(["conv-thread", threadId]);
      if (!thread) {
        const { data } = await supabase
          .from("conversation_threads")
          .select("*")
          .eq("id", threadId)
          .maybeSingle();
        thread = (data || undefined) as ConversationThread | undefined;
        if (thread) qc.setQueryData(["conv-thread", threadId], thread);
      }
      if (!thread) throw new Error("Conversa não encontrada");
      if (thread.status === "closed") {
        throw new Error("Conversa encerrada — não é possível enviar novas mensagens.");
      }

      // Pré-checagem de permissão (espelha as RLS policies)
      const isCandidate = thread.candidate_id === user.id;
      const isUnitRecruiter =
        Array.isArray(unitIds) && thread.unit_id ? unitIds.includes(thread.unit_id) : false;
      const isAdminOrRH = hasRole("admin") || hasRole("rh_franqueadora");
      if (!isCandidate && !isUnitRecruiter && !isAdminOrRH) {
        if (import.meta.env?.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[useSendMessage] sem permissão", {
            uid: user.id,
            thread_unit: thread.unit_id,
            unitIds,
            roles: { isAdminOrRH, isCandidate, isUnitRecruiter },
          });
        }
        throw new Error("Você não tem permissão para enviar mensagens nesta conversa.");
      }

      const role: "candidato" | "recrutador" = isCandidate ? "candidato" : "recrutador";

      const action = enqueueSend(user.id, {
        threadId,
        body: trimmed,
        senderId: user.id,
        senderRole: role,
      });
      console.info("[conv-ui] send_enqueued", {
        threadId,
        actionId: action.id,
        tempId: action.tempId,
        clientActionId: action.clientActionId,
        role,
        body: action.body,
      });

      // Insere mensagem otimista no cache com tempId
      const optimistic: ConversationMessage = {
        id: action.tempId,
        thread_id: threadId,
        sender_id: user.id,
        sender_role: role,
        body: action.body,
        read_at: null,
        created_at: new Date().toISOString(),
        client_action_id: action.clientActionId || null,
        pending: true,
        outboxActionId: action.id,
      };
      qc.setQueryData<ConversationMessage[]>(["conv-messages", threadId], (prev) => {
        if (!prev) return [optimistic];
        const exists = prev.some((m) => m.id === optimistic.id || (m.client_action_id && m.client_action_id === optimistic.client_action_id));
        if (exists) return prev;
        return dedupeConversationMessages([...prev, optimistic]);
      });

      // Tenta flush imediato (se online)
      const result = await flushOutbox(user.id);
      const sent = result.sent.find((s) => s.tempId === action.tempId);
      console.info("[conv-ui] flush_after_send", {
        threadId,
        actionId: action.id,
        tempId: action.tempId,
        result,
        sent,
        outboxStatus: loadOutbox(user.id).find((a) => a.id === action.id),
      });
      if (sent) {
        // troca tempId pelo id real (ou apenas remove pending; realtime trará o registro)
        qc.setQueryData<ConversationMessage[]>(["conv-messages", threadId], (prev) => {
          if (!prev) return prev;
          console.info("[conv-ui] mark_temp_sent", {
            threadId,
            tempId: action.tempId,
            realId: sent.realId,
            beforeCount: prev.length,
          });
          const realMessage = sent.realId
            ? ({
                ...optimistic,
                id: sent.realId,
                pending: false,
                failed: false,
                outboxActionId: undefined,
              } as ConversationMessage)
            : null;
          if (realMessage) {
            markMessageProcessed(realMessage.id);
            const realIdx = prev.findIndex((m) => !isOptimisticMessage(m) && hasSameMessageIdentity(m, realMessage));
            if (realIdx !== -1) {
              const next = prev
                .filter((m, idx) => idx === realIdx || m.id !== action.tempId)
                .map((m, idx) =>
                  idx === realIdx
                    ? { ...m, pending: false, failed: false, outboxActionId: undefined }
                    : m
                );
              return removeOptimisticDuplicates(next, realMessage);
            }
            const tempIdx = prev.findIndex((m) => m.id === action.tempId || m.outboxActionId === action.id);
            if (tempIdx !== -1) {
              const next = prev.slice();
              next[tempIdx] = realMessage;
              return removeOptimisticDuplicates(next, realMessage);
            }
            return dedupeConversationMessages(prev);
          }
          const next = prev.map((m) =>
            m.id === action.tempId
              ? { ...m, pending: false, failed: false, outboxActionId: undefined }
              : m
          );
          const seen = new Set<string>();
          return next.filter((m) => {
            const key = `${m.id}|${m.sender_id}|${m.body}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
      } else {
        // Não foi enviada nesta tentativa. Verifica no outbox se virou "failed"
        // (ex.: 403 por permissão/conversa fechada) para refletir no UI.
        const current = loadOutbox(user.id).find((a) => a.id === action.id);
        console.info("[conv-ui] send_not_confirmed", { threadId, actionId: action.id, tempId: action.tempId, current });
        if (current?.status === "failed") {
          qc.setQueryData<ConversationMessage[]>(["conv-messages", threadId], (prev) => {
            if (!prev) return prev;
            return prev.map((m) => (m.id === action.tempId ? { ...m, failed: true, pending: false } : m));
          });
          const raw = current.lastError || "";
          const friendly =
            /row-level security|violates row-level|permission denied|403/i.test(raw)
              ? "Você não tem permissão para enviar mensagens nesta conversa."
              : raw || "Falha ao enviar mensagem";
          throw new Error(friendly);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conv-threads"] });
    },
  });
}

// === Open or get thread (recruiter side) ===
export function useOpenThreadForApplication() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (applicationId: string): Promise<string> => {
      // Check if exists
      const { data: existing } = await supabase
        .from("conversation_threads")
        .select("id")
        .eq("application_id", applicationId)
        .maybeSingle();
      if (existing?.id) return existing.id;

      // Need application metadata to fill unit_id + candidate_id
      const { data: app, error: appErr } = await supabase
        .from("applications")
        .select("id, candidate_id, unit_jobs!inner(unit_id)")
        .eq("id", applicationId)
        .maybeSingle();
      if (appErr) throw appErr;
      if (!app) throw new Error("Candidatura não encontrada");

      const unitId = (app as any).unit_jobs?.unit_id;
      const { data: created, error } = await supabase
        .from("conversation_threads")
        .insert({
          application_id: applicationId,
          candidate_id: app.candidate_id,
          unit_id: unitId,
          opened_by: user!.id,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return created!.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conv-threads"] });
    },
  });
}

// === Total unread (for badge on Home) ===
export function useUnreadMessagesTotal() {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();

  // Realtime: invalidar contagem ao receber/atualizar mensagens (com reconexão automática + coalescer)
  const qcRef = useRef(qc);
  qcRef.current = qc;
  const coalescerRef = useRef<Coalescer | null>(null);
  if (!coalescerRef.current) {
    coalescerRef.current = createCoalescer({ qc, label: "conv-unread" });
  }
  // Throttle de 2s para rajadas de eventos realtime (evita N refetches/s)
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttleLastRunRef = useRef<number>(0);
  useEffect(() => {
    if (!user?.id) return;
    const THROTTLE_MS = 2000;
    const runInvalidate = () => {
      throttleLastRunRef.current = Date.now();
      throttleTimerRef.current = null;
      coalescerRef.current?.schedule(["conv-unread-total"]);
      coalescerRef.current?.schedule(["conv-threads"]);
    };
    const invalidate = () => {
      if (throttleTimerRef.current) return;
      const elapsed = Date.now() - throttleLastRunRef.current;
      const wait = elapsed >= THROTTLE_MS ? 0 : THROTTLE_MS - elapsed;
      throttleTimerRef.current = setTimeout(runInvalidate, wait);
    };
    const cleanup = createReconnectingChannel({
      baseName: `conv-unread:${user.id}`,
      attach: (channel) =>
        channel
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_messages" }, invalidate)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_messages" }, invalidate)
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "conversation_messages" }, invalidate),
      onResync: invalidate,
    });
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      cleanup();
    };
  }, [user?.id]);

  useEffect(() => () => { coalescerRef.current?.dispose(); coalescerRef.current = null; }, []);

  return useQuery({
    queryKey: ["conv-unread-total", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const role = hasRole("candidato") ? "candidato" : "recrutador";
      // For candidate: count unread messages from recruiter in their threads
      // For recruiter: count unread from candidato
      const otherRole = role === "candidato" ? "recrutador" : "candidato";
      // RLS (msg_select_participants) já restringe às threads visíveis ao usuário,
      // então não precisamos pré-buscar thread ids nem usar .in() — evita URLs longas e 400.
      const { count, error } = await supabase
        .from("conversation_messages")
        .select("id", { count: "exact", head: true })
        .eq("sender_role", otherRole)
        .is("read_at", null);
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

// === Recruiter inbox (threads for any unit the recruiter can access) ===
export function useRecruiterThreads() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["conv-threads", "recruiter", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: threads, error } = await supabase
        .from("conversation_threads")
        .select(`
          *,
          applications:application_id ( id, status, unit_jobs!inner (units (id, name), jobs (id, title)) )
        `)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      const threadIds = (threads || []).map((t: any) => t.id);
      if (threadIds.length === 0) return [];
      const idChunks = chunk(threadIds);
      const lastMsgsChunks = await Promise.all(
        idChunks.map((ids) =>
          supabase
            .from("conversation_messages")
            .select("thread_id, body, sender_role, created_at")
            .in("thread_id", ids)
            .order("created_at", { ascending: false })
        )
      );
      const lastMsgs = lastMsgsChunks.flatMap((r) => r.data || []);
      const unreadChunks = await Promise.all(
        idChunks.map((ids) =>
          supabase
            .from("conversation_messages")
            .select("thread_id")
            .in("thread_id", ids)
            .eq("sender_role", "candidato")
            .is("read_at", null)
        )
      );
      const unread = unreadChunks.flatMap((r) => r.data || []);
      const lastByThread: Record<string, any> = {};
      for (const m of lastMsgs || []) if (!lastByThread[m.thread_id]) lastByThread[m.thread_id] = m;
      const unreadByThread: Record<string, number> = {};
      for (const u of unread || []) unreadByThread[u.thread_id] = (unreadByThread[u.thread_id] || 0) + 1;

      // candidate names (profiles.id = auth user id)
      const candIds = Array.from(new Set((threads || []).map((t: any) => t.candidate_id)));
      const { data: profiles } = await (supabase as any)
        .from("profiles")
        .select("id, full_name")
        .in("id", candIds);
      const nameByUser: Record<string, string> = {};
      for (const p of profiles || []) nameByUser[(p as any).id] = (p as any).full_name;

      const mapped = (threads || []).map((t: any) => ({
        ...t,
        lastMessage: lastByThread[t.id] || null,
        unreadCount: unreadByThread[t.id] || 0,
        candidateName: nameByUser[t.candidate_id] || "Candidato",
        jobTitle: t.applications?.unit_jobs?.jobs?.title || "Vaga",
        unitName: t.applications?.unit_jobs?.units?.name || "Unidade",
      }));
      // Ordena por última atividade (mensagem ou criação), recém-abertas sobem
      mapped.sort((a: any, b: any) => {
        const ka = new Date(a.last_message_at || a.created_at).getTime();
        const kb = new Date(b.last_message_at || b.created_at).getTime();
        return kb - ka;
      });
      return mapped;
    },
    refetchOnWindowFocus: false,
  });
}

// === Recruiter inbox paginated (10 por página, busca server-side por nome) ===
export const RECRUITER_THREADS_PAGE_SIZE = 10;
export function useRecruiterThreadsPaged(search: string = "", filter: "all" | "unread" | "read" = "all") {
  const { user } = useAuth();
  const term = search.trim();
  return useInfiniteQuery({
    queryKey: ["conv-threads", "recruiter-paged", user?.id, term.toLowerCase(), filter],
    enabled: !!user?.id,
    initialPageParam: 0,
    getNextPageParam: (lastPage: any) => (lastPage?.hasMore ? lastPage.nextPage : undefined),
    queryFn: async ({ pageParam = 0 }) => {
      const page = pageParam as number;
      const from = page * RECRUITER_THREADS_PAGE_SIZE;
      const to = from + RECRUITER_THREADS_PAGE_SIZE - 1;

      // Quando há busca: 1) resolver candidate_ids por nome (server-side) e filtrar threads
      let candidateIdsFilter: string[] | null = null;
      if (term.length >= 1) {
        const { data: matchProfiles } = await (supabase as any)
          .from("profiles")
          .select("id, full_name")
          .ilike("full_name", `%${term}%`)
          .limit(500);
        candidateIdsFilter = (matchProfiles || []).map((p: any) => p.id);
        if (candidateIdsFilter.length === 0) {
          return { items: [], nextPage: page + 1, hasMore: false };
        }
      }

      // Filtro lidas/não lidas: descobrir os thread_ids com mensagens do candidato ainda não lidas
      let unreadThreadIds: string[] | null = null;
      if (filter === "unread" || filter === "read") {
        const { data: unreadRows } = await supabase
          .from("conversation_messages")
          .select("thread_id")
          .eq("sender_role", "candidato")
          .is("read_at", null);
        unreadThreadIds = Array.from(new Set((unreadRows || []).map((r: any) => r.thread_id)));
        if (filter === "unread" && unreadThreadIds.length === 0) {
          return { items: [], nextPage: page + 1, hasMore: false };
        }
      }


      let q = supabase
        .from("conversation_threads")
        .select(`
          *,
          applications:application_id ( id, status, unit_jobs!inner (units (id, name), jobs (id, title)) )
        `)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (candidateIdsFilter) q = q.in("candidate_id", candidateIdsFilter);
      if (filter === "unread" && unreadThreadIds) q = q.in("id", unreadThreadIds);
      if (filter === "read" && unreadThreadIds && unreadThreadIds.length > 0) {
        q = q.not("id", "in", `(${unreadThreadIds.join(",")})`);
      }


      const { data: threads, error } = await q;
      if (error) throw error;
      const list = threads || [];
      const threadIds = list.map((t: any) => t.id);

      let lastMsgs: any[] = [];
      let unread: any[] = [];
      if (threadIds.length > 0) {
        const [{ data: lm }, { data: un }] = await Promise.all([
          supabase
            .from("conversation_messages")
            .select("thread_id, body, sender_role, created_at")
            .in("thread_id", threadIds)
            .order("created_at", { ascending: false }),
          supabase
            .from("conversation_messages")
            .select("thread_id")
            .in("thread_id", threadIds)
            .eq("sender_role", "candidato")
            .is("read_at", null),
        ]);
        lastMsgs = lm || [];
        unread = un || [];
      }
      const lastByThread: Record<string, any> = {};
      for (const m of lastMsgs) if (!lastByThread[m.thread_id]) lastByThread[m.thread_id] = m;
      const unreadByThread: Record<string, number> = {};
      for (const u of unread) unreadByThread[u.thread_id] = (unreadByThread[u.thread_id] || 0) + 1;

      const candIds = Array.from(new Set(list.map((t: any) => t.candidate_id)));
      let nameByUser: Record<string, string> = {};
      if (candIds.length > 0) {
        const { data: profiles } = await (supabase as any)
          .from("profiles")
          .select("id, full_name")
          .in("id", candIds);
        for (const p of profiles || []) nameByUser[(p as any).id] = (p as any).full_name;
      }

      const items = list.map((t: any) => ({
        ...t,
        lastMessage: lastByThread[t.id] || null,
        unreadCount: unreadByThread[t.id] || 0,
        candidateName: nameByUser[t.candidate_id] || "Candidato",
        jobTitle: t.applications?.unit_jobs?.jobs?.title || "Vaga",
        unitName: t.applications?.unit_jobs?.units?.name || "Unidade",
      }));

      return {
        items,
        nextPage: page + 1,
        hasMore: list.length === RECRUITER_THREADS_PAGE_SIZE,
      };
    },
    refetchOnWindowFocus: false,
  });
}

