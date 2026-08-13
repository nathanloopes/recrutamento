import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface JourneyEvent {
  id: string;
  application_id: string;
  candidate_id: string | null;
  cycle_number: number | null;
  event_type: string;
  phase_id: string | null;
  phase_kind: string | null;
  phase_label: string | null;
  from_status: string | null;
  to_status: string | null;
  skipped: boolean;
  skip_reason: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  source: string | null;
  origin_link_id: string | null;
  origin_channel: string | null;
  origin_campaign: string | null;
  score: number | null;
  details: Record<string, any>;
  created_at: string;
}

export function useApplicationJourney(applicationId?: string | null) {
  return useQuery({
    queryKey: ["application-journey", applicationId],
    enabled: !!applicationId,
    queryFn: async (): Promise<JourneyEvent[]> => {
      const { data, error } = await supabase.rpc(
        "get_application_journey" as any,
        { _application_id: applicationId } as any
      );
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
}
