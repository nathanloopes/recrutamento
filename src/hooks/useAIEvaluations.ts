import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AIEvaluation {
  id: string;
  step_response_id: string;
  application_id: string;
  criteria_scores: Record<string, number>;
  final_score: number;
  decision: string;
  strengths: string[];
  risks: string[];
  explanation: string;
  prompt_version: string | null;
  model_provider: string;
  model_version: string | null;
  processing_time_ms: number | null;
  created_at: string;
}

export function useAIEvaluations(filters?: { decision?: string }) {
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["ai-evaluations", filters, isSuperAdmin, unitIds],
    queryFn: async () => {
      let query = supabase
        .from("ai_evaluations" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filters?.decision) {
        query = query.eq("decision", filters.decision);
      }

      const { data, error } = await query;
      if (error) throw error;
      let result = (data ?? []) as unknown as AIEvaluation[];

      // Non-admin: filtrar por unidades vinculadas via application → unit_job
      if (!isSuperAdmin && unitIds.length > 0 && result.length > 0) {
        const appIds = [...new Set(result.map((e) => e.application_id).filter(Boolean))];
        if (appIds.length > 0) {
          const { data: apps } = await supabase
            .from("applications")
            .select("id, unit_job_id, unit_jobs(unit_id)")
            .in("id", appIds);
          const allowedAppIds = new Set(
            (apps || [])
              .filter((a: any) => a.unit_jobs?.unit_id && unitIds.includes(a.unit_jobs.unit_id))
              .map((a: any) => a.id)
          );
          result = result.filter((e) => allowedAppIds.has(e.application_id));
        }
      }

      return result;
    },
  });
}

export function useAIEvaluationsByApplication(applicationId: string | undefined) {
  return useQuery({
    queryKey: ["ai-evaluations", "application", applicationId],
    queryFn: async () => {
      if (!applicationId) return [];
      const { data, error } = await supabase
        .from("ai_evaluations" as any)
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AIEvaluation[];
    },
    enabled: !!applicationId,
  });
}

export async function triggerEvaluation(stepResponseId: string, applicationId: string) {
  const { data, error } = await supabase.functions.invoke("evaluate-candidate", {
    body: { step_response_id: stepResponseId, application_id: applicationId },
  });

  if (error) throw new Error(error.message || "Evaluation failed");
  if (data?.error) throw new Error(data.error);

  return data;
}
