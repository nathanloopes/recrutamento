import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LinkMetricRow {
  link_id: string;
  token: string;
  channel: string;
  campaign: string | null;
  label: string | null;
  job_id: string;
  job_title: string | null;
  unit_id: string;
  unit_name: string | null;
  unit_city: string | null;
  unit_state: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  deactivated_at: string | null;
  clicks: number;
  applications: number;
  em_andamento: number;
  aprovado: number;
  contratado: number;
  desistente: number;
  desligado: number;
  on_hold: number;
  conv_rate: number | null;
  hire_rate: number | null;
}

export interface LinkMetricsFilters {
  from?: string | null;
  to?: string | null;
  channel?: string | null;
  campaign?: string | null;
  jobId?: string | null;
  unitId?: string | null;
}

export function useRecruitmentLinksMetrics(filters: LinkMetricsFilters) {
  return useQuery({
    queryKey: ["recruitment_links_metrics", filters],
    queryFn: async (): Promise<LinkMetricRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_recruitment_links_metrics", {
        _from: filters.from ?? null,
        _to: filters.to ?? null,
        _channel: filters.channel ?? null,
        _campaign: filters.campaign ?? null,
        _job_id: filters.jobId ?? null,
        _unit_id: filters.unitId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as LinkMetricRow[];
    },
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}
