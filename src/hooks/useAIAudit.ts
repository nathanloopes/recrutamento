import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AIDecisionLog {
  id: string;
  cpf: string;
  module: string;
  decision_type: string;
  model_provider: string | null;
  model_version: string | null;
  processing_time_ms: number | null;
  input: any;
  output: any;
  application_id: string | null;
  evaluation_id: string | null;
  actor_id: string | null;
  created_at: string;
}

export interface AIAuditFilters {
  decision_type?: string;
  dateFrom?: string;
  dateTo?: string;
  cpf?: string;
}

export function useAIDecisionLogs(filters?: AIAuditFilters) {
  return useQuery({
    queryKey: ["ai-decision-logs", filters],
    queryFn: async () => {
      let query = supabase
        .from("ai_decision_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters?.decision_type) {
        query = query.eq("decision_type", filters.decision_type);
      }
      if (filters?.dateFrom) {
        query = query.gte("created_at", filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte("created_at", filters.dateTo + "T23:59:59");
      }
      if (filters?.cpf) {
        query = query.ilike("cpf", `%${filters.cpf}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AIDecisionLog[];
    },
  });
}
