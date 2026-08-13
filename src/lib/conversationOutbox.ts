import { supabase } from "@/integrations/supabase/client";
import { logChatSendError } from "@/lib/chatErrorLog";

// === Tipos ===
export type OutboxStatus = "pending" | "failed";

export type SendMessageAction = {
  id: string;
  kind: "send";
  threadId: string;
  body: string;
  senderId: string;
  senderRole: "candidato" | "recrutador";
  tempId: string;
  clientActionId?: string;
  createdAt: number;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
};

export type MarkReadAction = {
  id: string;
  kind: "mark_read";
  threadId: string;
  messageIds: string[];
  createdAt: number;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
};

export type OutboxAction = SendMessageAction | MarkReadAction;

const KEY_PREFIX = "conv-outbox:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const STORAGE_EVENT = "conv-outbox:change";
const DEBUG_OUTBOX = false;

const bus = new EventTarget();

function debugOutbox(_event: string, _payload?: Record<string, unknown>) {
  if (!DEBUG_OUTBOX) return;
}

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
      return (crypto as any).randomUUID();
    }
  } catch {}
  return `oa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function storageKey(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

export function loadOutbox(userId: string): OutboxAction[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OutboxAction[];
    if (!Array.isArray(parsed)) return [];
    // limpa expirados
    const now = Date.now();
    return parsed.filter((a) => now - a.createdAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function saveOutbox(userId: string, items: OutboxAction[]) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(items));
    bus.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { userId } }));
  } catch {}
}

export function subscribeOutbox(userId: string, listener: () => void): () => void {
  const onLocal = (e: Event) => {
    const ce = e as CustomEvent;
    if (ce.detail?.userId === userId) listener();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey(userId)) listener();
  };
  bus.addEventListener(STORAGE_EVENT, onLocal as EventListener);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    bus.removeEventListener(STORAGE_EVENT, onLocal as EventListener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function enqueueSend(
  userId: string,
  payload: { threadId: string; body: string; senderId: string; senderRole: "candidato" | "recrutador" }
): SendMessageAction {
  const action: SendMessageAction = {
    id: uuid(),
    kind: "send",
    threadId: payload.threadId,
    body: payload.body.slice(0, 2000),
    senderId: payload.senderId,
    senderRole: payload.senderRole,
    tempId: `temp_${uuid()}`,
    clientActionId: uuid(),
    createdAt: Date.now(),
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
  };
  const items = loadOutbox(userId);
  items.push(action);
  saveOutbox(userId, items);
  debugOutbox("enqueue_send", {
    actionId: action.id,
    tempId: action.tempId,
    clientActionId: action.clientActionId,
    threadId: action.threadId,
    senderRole: action.senderRole,
    body: action.body,
    outboxSize: items.length,
  });
  return action;
}

export function enqueueMarkRead(
  userId: string,
  payload: { threadId: string; messageIds: string[] }
): MarkReadAction | null {
  if (!payload.messageIds.length) return null;
  // dedupe contra ações pendentes
  const items = loadOutbox(userId);
  const existing = new Set<string>();
  for (const it of items) {
    if (it.kind === "mark_read") it.messageIds.forEach((m) => existing.add(m));
  }
  const fresh = payload.messageIds.filter((m) => !existing.has(m));
  if (!fresh.length) return null;
  const action: MarkReadAction = {
    id: uuid(),
    kind: "mark_read",
    threadId: payload.threadId,
    messageIds: fresh,
    createdAt: Date.now(),
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
  };
  items.push(action);
  saveOutbox(userId, items);
  return action;
}

export function removeAction(userId: string, actionId: string) {
  const items = loadOutbox(userId).filter((a) => a.id !== actionId);
  saveOutbox(userId, items);
}

export function removeActions(userId: string, actionIds: string[]) {
  if (!actionIds.length) return;
  const remove = new Set(actionIds);
  const before = loadOutbox(userId);
  const items = before.filter((a) => !remove.has(a.id));
  if (items.length === before.length) return;
  debugOutbox("remove_resolved_actions", { actionIds, before: before.length, after: items.length });
  saveOutbox(userId, items);
}

export function retryAction(userId: string, actionId: string) {
  const before = loadOutbox(userId).find((a) => a.id === actionId);
  debugOutbox("retry_action", {
    actionId,
    kind: before?.kind,
    status: before?.status,
    attempts: before?.attempts,
    clientActionId: before?.kind === "send" ? before.clientActionId : undefined,
    lastError: before?.lastError,
  });
  const items = loadOutbox(userId).map((a) =>
    a.id === actionId ? { ...a, status: "pending" as const, attempts: 0, nextAttemptAt: 0, lastError: undefined } : a
  );
  saveOutbox(userId, items);
}

export function retryAllFailed(userId: string) {
  const items = loadOutbox(userId).map((a) =>
    a.status === "failed" ? { ...a, status: "pending" as const, attempts: 0, nextAttemptAt: 0, lastError: undefined } : a
  );
  saveOutbox(userId, items);
}

function backoffMs(attempts: number) {
  return Math.min(30_000, 1000 * Math.pow(2, attempts)) + Math.floor(Math.random() * 500);
}

async function findAlreadySentMessage(action: SendMessageAction) {
  if (action.clientActionId) {
    const byClientAction = await (supabase as any)
      .from("conversation_messages")
      .select("id")
      .eq("client_action_id", action.clientActionId)
      .maybeSingle();
    if (byClientAction.data?.id) return byClientAction.data.id as string;
  }

  const since = new Date(action.createdAt - 1_000).toISOString();
  const until = new Date(Date.now() + 10_000).toISOString();
  const byContent = await supabase
    .from("conversation_messages")
    .select("id")
    .eq("thread_id", action.threadId)
    .eq("sender_id", action.senderId)
    .eq("sender_role", action.senderRole)
    .eq("body", action.body)
    .gte("created_at", since)
    .lte("created_at", until)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return byContent.data?.id as string | undefined;
}

// Erros lógicos (não retry): RLS, validação, unique. Códigos PG/PostgREST.
function isLogicalError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.status;
  if (typeof code === "string") {
    if (code.startsWith("22") || code.startsWith("23") || code === "42501" || code === "PGRST116") return true;
  }
  if (typeof code === "number" && code >= 400 && code < 500 && code !== 408 && code !== 429) return true;
  return false;
}

export type FlushResult = {
  sent: { tempId: string; threadId: string; realId?: string }[];
  marked: { threadId: string; messageIds: string[] }[];
};

let flushInFlight: Promise<FlushResult> | null = null;

export async function flushOutbox(userId: string): Promise<FlushResult> {
  if (!userId) return { sent: [], marked: [] };
  if (flushInFlight) {
    debugOutbox("flush_join_in_flight", { userId });
    return flushInFlight;
  }
  flushInFlight = (async () => {
    const result: FlushResult = { sent: [], marked: [] };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      debugOutbox("flush_skip_offline", { userId });
      return result;
    }

    let items = loadOutbox(userId);
    const now = Date.now();
    // ordena por criação (FIFO)
    items.sort((a, b) => a.createdAt - b.createdAt);
    debugOutbox("flush_start", {
      userId,
      total: items.length,
      pending: items.filter((a) => a.status === "pending").length,
      failed: items.filter((a) => a.status === "failed").length,
      sends: items.filter((a) => a.kind === "send").map((a) => ({
        id: a.id,
        tempId: a.tempId,
        clientActionId: a.clientActionId,
        threadId: a.threadId,
        status: a.status,
        attempts: a.attempts,
        nextAttemptInMs: Math.max(0, (a.nextAttemptAt || 0) - now),
        body: a.body,
      })),
    });

    for (const action of items) {
      if (action.status !== "pending") continue;
      if (action.nextAttemptAt && action.nextAttemptAt > now) {
        debugOutbox("action_skip_backoff", { actionId: action.id, kind: action.kind, nextAttemptAt: action.nextAttemptAt, now });
        continue;
      }

      try {
        if (action.kind === "send") {
          debugOutbox("send_attempt", {
            actionId: action.id,
            tempId: action.tempId,
            clientActionId: action.clientActionId,
            threadId: action.threadId,
            attempts: action.attempts,
            body: action.body,
          });
          const alreadySent = await findAlreadySentMessage(action).catch(() => undefined);
          if (alreadySent) {
            debugOutbox("send_already_sent_before_insert", { actionId: action.id, tempId: action.tempId, realId: alreadySent });
            result.sent.push({ tempId: action.tempId, threadId: action.threadId, realId: alreadySent });
            const cur = loadOutbox(userId).filter((a) => a.id !== action.id);
            saveOutbox(userId, cur);
            continue;
          }
          const clientActionId = action.clientActionId || action.id;
          const { data, error } = await (supabase as any)
            .from("conversation_messages")
            .insert({
              thread_id: action.threadId,
              sender_id: action.senderId,
              sender_role: action.senderRole,
              body: action.body,
              client_action_id: clientActionId,
            })
            .select("id")
            .maybeSingle();
          if (error) {
            debugOutbox("send_insert_error", {
              actionId: action.id,
              tempId: action.tempId,
              clientActionId,
              code: error.code,
              status: (error as any).status,
              message: error.message,
            });
            throw error;
          }
          debugOutbox("send_insert_success", { actionId: action.id, tempId: action.tempId, clientActionId, realId: data?.id });
          result.sent.push({ tempId: action.tempId, threadId: action.threadId, realId: data?.id });
          // remove
          const cur = loadOutbox(userId).filter((a) => a.id !== action.id);
          saveOutbox(userId, cur);
        } else if (action.kind === "mark_read") {
          const { error } = await supabase
            .from("conversation_messages")
            .update({ read_at: new Date().toISOString() })
            .in("id", action.messageIds);
          if (error) throw error;
          result.marked.push({ threadId: action.threadId, messageIds: action.messageIds });
          const cur = loadOutbox(userId).filter((a) => a.id !== action.id);
          saveOutbox(userId, cur);
        }
      } catch (err: any) {
        if (action.kind === "send") {
          const existingId = await findAlreadySentMessage(action).catch(() => undefined);
          if (existingId) {
            debugOutbox("send_reconciled_after_error", {
              actionId: action.id,
              tempId: action.tempId,
              realId: existingId,
              originalErrorCode: err?.code ?? err?.status,
              originalErrorMessage: err?.message || String(err),
            });
            result.sent.push({ tempId: action.tempId, threadId: action.threadId, realId: existingId });
            const cur = loadOutbox(userId).filter((a) => a.id !== action.id);
            saveOutbox(userId, cur);
            continue;
          }
        }
        const cur = loadOutbox(userId);
        const idx = cur.findIndex((a) => a.id === action.id);
        if (idx === -1) continue;
        const attempts = (cur[idx].attempts || 0) + 1;
        const logical = isLogicalError(err);
        const newStatus: OutboxStatus = logical || attempts >= 8 ? "failed" : "pending";
        debugOutbox("action_failed", {
          actionId: action.id,
          kind: action.kind,
          attempts,
          logical,
          newStatus,
          code: err?.code ?? err?.status,
          message: err?.message || String(err),
        });
        cur[idx] = {
          ...cur[idx],
          attempts,
          lastError: err?.message || String(err),
          nextAttemptAt: Date.now() + backoffMs(attempts),
          status: newStatus,
        } as OutboxAction;
        saveOutbox(userId, cur);
        // Auditoria: se virou "failed" e é envio de mensagem, persiste no banco.
        if (newStatus === "failed" && action.kind === "send") {
          void logChatSendError({
            threadId: action.threadId,
            senderId: action.senderId,
            senderRole: action.senderRole,
            body: action.body,
            errorCode: (err?.code ?? err?.status)?.toString() ?? null,
            errorMessage: err?.message || String(err),
            attempts,
          });
        }
        // se erro de rede, para o ciclo (provavelmente offline novamente)
        if (!logical && (err?.message?.includes("fetch") || err?.message?.includes("network"))) {
          break;
        }
      }
    }
    return result;
  })();
  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}
