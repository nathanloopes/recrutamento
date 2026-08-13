import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface FAQSuggestion {
  suggested_question: string;
  suggested_answer: string;
  suggested_tags: string[];
  is_duplicate: boolean;
  similar_articles: { id: string; question: string }[];
}

export function useGenerateFAQFromTicket() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { data, error } = await supabase.functions.invoke("generate-faq-from-ticket", {
        body: { ticket_id: ticketId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as FAQSuggestion;
    },
    onError: (err: any) => {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível gerar sugestão de FAQ.",
        variant: "destructive",
      });
    },
  });
}

export interface SupportTicket {
  id: string;
  candidate_id: string;
  question: string;
  ai_answer: string | null;
  ai_confidence: number;
  matched_article_ids: string[];
  status: string;
  context: any;
  resolved_by: string | null;
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function useMySupportTickets() {
  return useQuery({
    queryKey: ["my-support-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SupportTicket[];
    },
  });
}

export function useAllSupportTickets(statusFilter?: string) {
  return useQuery({
    queryKey: ["all-support-tickets", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("support_tickets" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (statusFilter && statusFilter !== "todos") {
        query = query.eq("status", statusFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as SupportTicket[];
    },
  });
}

export function useAskFAQAssistant() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (question: string) => {
      const { data, error } = await supabase.functions.invoke("faq-assistant", {
        body: { question },
      });
      if (error) {
        // Extract real error message from edge function response when possible
        let msg = "Não foi possível processar sua dúvida.";
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* ignore parse errors */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data as {
        answer: string;
        confidence: number;
        resolved: boolean;
        log_id: string | null;
        related_articles: { id: string; question: string; answer: string }[];
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my_faq_questions"] });
      queryClient.invalidateQueries({ queryKey: ["my_unread_faq_answers"] });
      queryClient.invalidateQueries({ queryKey: ["faq_unanswered"] });
      queryClient.invalidateQueries({ queryKey: ["faq_open_count"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro",
        description: err.message || "Não foi possível processar sua dúvida.",
        variant: "destructive",
      });
    },
  });
}

export function useUpdateTicketContext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, context }: { ticketId: string; context: any }) => {
      const { error } = await supabase
        .from("support_tickets" as any)
        .update({ context, status: "aberto" } as any)
        .eq("id", ticketId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-support-tickets"] });
    },
  });
}

export function useRespondTicket() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      response,
      adminId,
    }: {
      ticketId: string;
      response: string;
      adminId: string;
    }) => {
      const { error } = await supabase
        .from("support_tickets" as any)
        .update({
          admin_response: response,
          resolved_by: adminId,
          status: "fechado",
          resolved_at: new Date().toISOString(),
        } as any)
        .eq("id", ticketId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Chamado respondido e fechado." });
      queryClient.invalidateQueries({ queryKey: ["all-support-tickets"] });
    },
    onError: () => {
      toast({ title: "Erro ao responder chamado", variant: "destructive" });
    },
  });
}
