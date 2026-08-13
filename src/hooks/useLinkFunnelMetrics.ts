import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LinkFunnelFilters {
  from?: string | null;
  to?: string | null;
  unitId?: string | null;
  jobId?: string | null;
  channel?: string | null;
}

export interface LinkFunnelRow {
  unit_id: string | null;
  unit_name: string | null;
  job_id: string | null;
  job_title: string | null;
  total_applied: number;
  total_pendente: number;
  total_test: number;
  total_interview: number;
  total_aprovado: number;
  total_contratado: number;
  rate_test: number | null;
  rate_interview: number | null;
  rate_aprovado: number | null;
  rate_contratado: number | null;
}

export interface LinkFunnelSummary {
  total_applied: number;
  total_pendente: number;
  total_test: number;
  total_interview: number;
  total_aprovado: number;
  total_contratado: number;
}

function toArgs(f: LinkFunnelFilters) {
  return {
    _from: f.from ?? null,
    _to: f.to ?? null,
    _unit_id: f.unitId ?? null,
    _job_id: f.jobId ?? null,
    _channel: f.channel ?? null,
  };
}

export function useLinkFunnelMetrics(filters: LinkFunnelFilters) {
  return useQuery({
    queryKey: ["link_funnel_metrics", filters],
    queryFn: async (): Promise<LinkFunnelRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_link_funnel_metrics", toArgs(filters));
      if (error) throw error;
      return (data ?? []) as LinkFunnelRow[];
    },
  });
}

export function useLinkFunnelSummary(filters: LinkFunnelFilters) {
  return useQuery({
    queryKey: ["link_funnel_summary", filters],
    queryFn: async (): Promise<LinkFunnelSummary> => {
      const { data, error } = await (supabase.rpc as any)("get_link_funnel_summary", toArgs(filters));
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? {
        total_applied: 0,
        total_pendente: 0,
        total_test: 0,
        total_interview: 0,
        total_aprovado: 0,
        total_contratado: 0,
      }) as LinkFunnelSummary;
    },
  });
}
