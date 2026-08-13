import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ChatSendError = {
  id: string;
  created_at: string;
  thread_id: string | null;
  sender_id: string;
  sender_role: "candidato" | "recrutador";
  body: string;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  status: "failed" | "resent" | "discarded";
  resolved_at: string | null;
  resolved_by: string | null;
  sender_name?: string;
};

export type ChatErrorFilters = {
  status?: "failed" | "resent" | "discarded" | "all";
  dateFrom?: string;
  dateTo?: string;
};

export function useChatSendErrors(filters: ChatErrorFilters = {}) {
  return useQuery({
    queryKey: ["chat-send-errors", filters],
    queryFn: async (): Promise<ChatSendError[]> => {
      let q = supabase
        .from("chat_send_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.dateFrom) q = q.gte("created_at", `${filters.dateFrom}T00:00:00`);
      if (filters.dateTo) q = q.lte("created_at", `${filters.dateTo}T23:59:59`);

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as ChatSendError[];

      const ids = Array.from(new Set(rows.map((r) => r.sender_id))).filter(Boolean);
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        const map = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
        rows.forEach((r) => {
          r.sender_name = map.get(r.sender_id) || "—";
        });
      }
      return rows;
    },
    staleTime: 30_000,
  });
}

export function useResendChatError() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: ChatSendError) => {
      if (!row.thread_id) throw new Error("Thread inexistente para reenvio.");
      const { error: sendErr } = await supabase.from("conversation_messages").insert({
        thread_id: row.thread_id,
        sender_id: row.sender_id,
        sender_role: row.sender_role,
        body: row.body,
      });
      if (sendErr) throw sendErr;
      const { data: u } = await supabase.auth.getUser();
      await supabase
        .from("chat_send_errors")
        .update({
          status: "resent",
          resolved_at: new Date().toISOString(),
          resolved_by: u.user?.id ?? null,
        })
        .eq("id", row.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-send-errors"] }),
  });
}

export function useDiscardChatError() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: ChatSendError) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("chat_send_errors")
        .update({
          status: "discarded",
          resolved_at: new Date().toISOString(),
          resolved_by: u.user?.id ?? null,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-send-errors"] }),
  });
}
