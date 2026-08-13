import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { sendPushToDevice } from "@/hooks/useNotifications";

export interface FAQArticle {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  status: string;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FAQFeedback {
  id: string;
  faq_article_id: string;
  user_id: string;
  helpful: boolean;
  comment: string | null;
  created_at: string;
}

export interface FAQAILog {
  id: string;
  user_id: string;
  question: string;
  matched_article_ids: string[];
  answer: string | null;
  confidence: number;
  created_at: string;
}

// ── Admin hooks ──

export function useFAQArticles(filters?: { status?: string; tag?: string }) {
  return useQuery({
    queryKey: ["faq_articles", filters],
    queryFn: async () => {
      let query = supabase.from("faq_articles").select("*");
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.tag) query = query.contains("tags", [filters.tag]);
      const { data, error } = await query.order("question", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as FAQArticle[];
    },
  });
}

export function useCreateArticle() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (article: { question: string; answer: string; tags: string[]; status: string }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("faq_articles").insert({
        question: article.question,
        answer: article.answer,
        tags: article.tags,
        status: article.status,
        created_by: u.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_articles"] });
      toast({ title: "Artigo criado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateArticle() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; question?: string; answer?: string; tags?: string[]; status?: string }) => {
      const updates: Record<string, unknown> = { ...fields };
      if (fields.question || fields.answer) {
        const { data, error: vErr } = await supabase.from("faq_articles").select("version").eq("id", id).single();
        if (vErr) throw vErr;
        updates.version = ((data as any)?.version ?? 0) + 1;
      }
      const { error } = await supabase.from("faq_articles").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_articles"] });
      toast({ title: "Artigo atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useArchiveArticle() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("faq_articles").update({ status: "arquivado" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_articles"] });
      toast({ title: "Artigo arquivado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useFAQFeedbacks(articleId?: string) {
  return useQuery({
    queryKey: ["faq_feedback", articleId],
    queryFn: async () => {
      let query = supabase.from("faq_feedback").select("*");
      if (articleId) query = query.eq("faq_article_id", articleId);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FAQFeedback[];
    },
  });
}

export function useFAQLogs() {
  return useQuery({
    queryKey: ["faq_ai_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("faq_ai_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as FAQAILog[];
    },
  });
}

// ── User hooks ──

export function usePublishedFAQ(search?: string, tag?: string) {
  return useQuery({
    queryKey: ["faq_published", search, tag],
    queryFn: async () => {
      let query = supabase.from("faq_articles").select("*").eq("status", "publicado");
      if (tag) query = query.contains("tags", [tag]);
      if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(`question.ilike.${term},answer.ilike.${term}`);
      }
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FAQArticle[];
    },
  });
}

/**
 * Resolve created_by (uuid) -> nome do admin autor, para exibir "quem respondeu"
 * no FAQ. Best-effort: se o público (ex.: franqueado/gestor) não puder ler
 * admin_users por RLS, retorna {} e a UI cai no rótulo genérico.
 */
export function useAdminNames(ids: (string | null | undefined)[]) {
  const uniqueIds = [...new Set(ids.filter((v): v is string => !!v))].sort();
  return useQuery({
    queryKey: ["admin_names", uniqueIds],
    enabled: uniqueIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_users")
        .select("id, name")
        .in("id", uniqueIds);
      if (error) {
        console.warn("[FAQ] não foi possível resolver autores:", error.message);
        return {} as Record<string, string>;
      }
      return Object.fromEntries(
        ((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name])
      ) as Record<string, string>;
    },
  });
}

export function useSubmitFeedback() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (fb: { faq_article_id: string; helpful: boolean; comment?: string }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("faq_feedback").insert({
        faq_article_id: fb.faq_article_id,
        user_id: u.user?.id ?? "",
        helpful: fb.helpful,
        comment: fb.comment || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_feedback"] });
      toast({ title: "Obrigado pelo feedback!" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useLogFAQQuery() {
  return useMutation({
    mutationFn: async (log: { question: string; matched_article_ids: string[]; answer: string | null; confidence: number }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("faq_ai_logs").insert({
        user_id: u.user?.id ?? "",
        question: log.question,
        matched_article_ids: log.matched_article_ids,
        answer: log.answer,
        confidence: log.confidence,
      } as any);
      if (error) throw error;
    },
  });
}

// ── Admin: pending questions ──

export function useUnansweredQuestions() {
  return useQuery({
    queryKey: ["faq_unanswered"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("faq_ai_logs")
        .select("*") as any)
        .eq("status", "pendente")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as (FAQAILog & { status: string; admin_response: string | null })[];
    },
  });
}

export function useOpenQuestionsCount() {
  return useQuery({
    queryKey: ["faq_open_count"],
    queryFn: async () => {
      const { count, error } = await (supabase
        .from("faq_ai_logs")
        .select("id", { count: "exact", head: true }) as any)
        .eq("status", "pendente");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });
}

export function useRespondToQuestion() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, admin_response }: { id: string; admin_response: string }) => {
      // Fetch the log to get user_id and question
      const { data: log, error: fetchErr } = await supabase
        .from("faq_ai_logs")
        .select("user_id, question")
        .eq("id", id)
        .single();
      if (fetchErr || !log) throw fetchErr || new Error("Log não encontrado");

      const { error } = await supabase
        .from("faq_ai_logs")
        .update({ admin_response, status: "respondido" } as any)
        .eq("id", id);
      if (error) throw error;

      // Create notification for the candidate
      const question = (log as any).question || "";
      const truncated = question.length > 80
        ? question.substring(0, 80) + "…"
        : question;
      await supabase.from("notifications").insert({
        event_type: "faq_resposta",
        recipient_id: (log as any).user_id,
        title: "Sua dúvida foi respondida",
        body: truncated,
        status: "sent",
        channel: "push",
        action_url: "/faq",
      });

      // Send real push notification
      sendPushToDevice({
        recipientId: (log as any).user_id,
        title: "Sua dúvida foi respondida",
        body: truncated,
        actionUrl: "/faq",
      }).catch((err) => console.error("[PUSH] FAQ push failed:", err));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_unanswered"] });
      qc.invalidateQueries({ queryKey: ["faq_open_count"] });
      toast({ title: "Resposta enviada ao candidato" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

// ── Admin: answered questions ──

export function useAnsweredQuestions() {
  return useQuery({
    queryKey: ["faq_answered"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("faq_ai_logs")
        .select("*") as any)
        .eq("status", "respondido")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as (FAQAILog & { status: string; admin_response: string | null })[];
    },
  });
}

export function useResetQuestion() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("faq_ai_logs")
        .update({ admin_response: null, status: "pendente" } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_answered"] });
      qc.invalidateQueries({ queryKey: ["faq_unanswered"] });
      qc.invalidateQueries({ queryKey: ["faq_open_count"] });
      toast({ title: "Resposta excluída — pergunta voltou para pendentes" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteQuestion() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      // Soft-delete: set status to 'arquivado' instead of DELETE (immutable logs)
      const { error } = await supabase
        .from("faq_ai_logs")
        .update({ status: "arquivado" } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_unanswered"] });
      qc.invalidateQueries({ queryKey: ["faq_answered"] });
      qc.invalidateQueries({ queryKey: ["faq_open_count"] });
      qc.invalidateQueries({ queryKey: ["faq_ai_logs"] });
      toast({ title: "Pergunta arquivada com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao arquivar", description: e.message, variant: "destructive" }),
  });
}

// ── Candidate: my questions with admin responses ──

export function useMyFAQQuestions() {
  return useQuery({
    queryKey: ["my_faq_questions"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("faq_ai_logs")
        .select("*")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as (FAQAILog & { status: string; admin_response: string | null; read_at: string | null })[];
    },
  });
}

export function useMyUnreadAnswersCount() {
  return useQuery({
    queryKey: ["faq_unread_count"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return 0;
      const { count, error } = await (supabase
        .from("faq_ai_logs")
        .select("id", { count: "exact", head: true }) as any)
        .eq("user_id", u.user.id)
        .eq("status", "respondido")
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });
}

export function useMarkAnswersRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { error } = await (supabase
        .from("faq_ai_logs")
        .update({ read_at: new Date().toISOString() } as any) as any)
        .eq("user_id", u.user.id)
        .eq("status", "respondido")
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["faq_unread_count"] });
      qc.invalidateQueries({ queryKey: ["my_faq_questions"] });
    },
  });
}
