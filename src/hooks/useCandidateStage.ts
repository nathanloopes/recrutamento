import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type CandidateStage =
  | "browsing"
  | "test_pending"
  | "test_failed"
  | "test_passed"
  | "unit_selection"
  | "applied";

/**
 * Read-only derivation of the candidate journey stage.
 * Independent from the onboarding tour state — a failed test never resets the tour.
 */
export function useCandidateStage() {
  const { profile } = useAuth();
  const candidateId = profile?.id;

  return useQuery({
    queryKey: ["candidate-stage", candidateId],
    enabled: !!candidateId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<CandidateStage> => {
      if (!candidateId) return "browsing";

      // 1) Active application?
      const { data: apps } = await supabase
        .from("applications")
        .select("id, status")
        .eq("candidate_id", candidateId)
        .limit(1);
      if (apps && apps.length > 0) return "applied";

      // 2) Talent pool entry → test status
      // Aprovação real é por vaga (jobs.min_score). Aqui só dizemos se já fez teste.
      const { data: pool } = await supabase
        .from("talent_pool_entries")
        .select("test_score, status")
        .eq("candidate_id", candidateId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pool) return "browsing";

      const score = (pool as any).test_score ?? null;
      if (score == null) return "test_pending";
      return "unit_selection";
    },
  });
}
