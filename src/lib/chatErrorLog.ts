import { supabase } from "@/integrations/supabase/client";

export type LogChatSendErrorInput = {
  threadId: string | null;
  senderId: string;
  senderRole: "candidato" | "recrutador";
  body: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  attempts?: number;
};

/**
 * Registra (fire-and-forget) uma falha de envio de mensagem em
 * `chat_send_errors` para a aba de auditoria > Chat.
 * Nunca lança — falhas de log são silenciosas para não criar loop.
 */
export async function logChatSendError(input: LogChatSendErrorInput): Promise<void> {
  try {
    if (!input.senderId || !input.body) return;
    await supabase.from("chat_send_errors").insert({
      thread_id: input.threadId,
      sender_id: input.senderId,
      sender_role: input.senderRole,
      body: input.body.slice(0, 2000),
      error_code: input.errorCode ?? null,
      error_message: (input.errorMessage ?? "").slice(0, 1000),
      attempts: input.attempts ?? 1,
      status: "failed",
    });
  } catch {
    /* noop */
  }
}
