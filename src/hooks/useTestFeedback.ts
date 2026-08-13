import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hooks dedicados ao fluxo de avaliação presencial de testes (test_feedback).
 * Totalmente desacoplado do fluxo de entrevistas (interview_feedback).
 */

export function useActiveTestGuide(jobId?: string) {
  return useQuery({
    queryKey: ["test_guide_active", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      // NÃO usar .maybeSingle(): pode haver mais de um roteiro ativo para o
      // mesmo cargo (duplicidade). maybeSingle() lançaria erro nesse caso e o
      // dialog mostraria "Nenhum roteiro ativo". Pegamos o mais recente
      // (maior versão, depois criado mais recente).
      const { data, error } = await supabase
        .from("test_guides" as any)
        .select("*")
        .eq("job_id", jobId!)
        .eq("is_active", true)
        .order("version", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const rows = (data as any[]) || [];
      return rows[0] ?? null;
    },
  });
}

export function useTestFeedback(params: { applicationId?: string; bookingId?: string }) {
  const { applicationId, bookingId } = params;
  return useQuery({
    queryKey: ["test_feedback", applicationId || null, bookingId || null],
    enabled: !!(applicationId || bookingId),
    queryFn: async () => {
      let q = supabase.from("test_feedback" as any).select("*, test_guides(*)").limit(1);
      if (bookingId) q = q.eq("booking_id", bookingId);
      else if (applicationId) q = q.eq("application_id", applicationId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data as any | null;
    },
  });
}

export interface SubmitTestFeedbackInput {
  application_id: string;
  booking_id?: string | null;
  test_guide_id?: string | null;
  test_guide_version?: number | null;
  evaluator_id: string;
  unit_id?: string | null;
  checklist_json: any;
  decision: "aprovado" | "reprovado" | "standby" | "encerrado" | "declinado";
  standby_reason?: string | null;
  notes?: string | null;
  risk_score?: number | null;
  recruiter_average?: number | null;
}

export function useSubmitTestFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitTestFeedbackInput) => {
      const { data, error } = await supabase
        .from("test_feedback" as any)
        .insert({ ...input, finalized_at: new Date().toISOString() } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_feedback"] });
      qc.invalidateQueries({ queryKey: ["test_bookings_list"] });
      qc.invalidateQueries({ queryKey: ["test_assignments"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}
