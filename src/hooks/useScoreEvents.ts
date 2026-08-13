import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ScoreEvent {
  id: string;
  candidate_id: string;
  event_type: string;
  process_stage: string | null;
  related_job_id: string | null;
  previous_score: number;
  score_delta: number;
  new_score: number;
  reason: string;
  metadata: Record<string, any>;
  created_at: string;
}

export function useScoreEvents(candidateId?: string) {
  const { user } = useAuth();
  const id = candidateId || user?.id;

  return useQuery({
    queryKey: ["score_events", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("score_events" as any)
        .select("*")
        .eq("candidate_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ScoreEvent[];
    },
  });
}
