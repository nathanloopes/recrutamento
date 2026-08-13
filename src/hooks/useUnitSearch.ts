import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useDistinctStates() {
  return useQuery({
    queryKey: ["unit_states"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("state")
        .eq("is_active", true)
        .not("state", "is", null);
      if (error) throw error;
      const states = [...new Set(data.map((u: any) => u.state as string))].sort();
      return states;
    },
  });
}

export function useCitiesByState(state: string | null) {
  return useQuery({
    queryKey: ["unit_cities", state],
    enabled: !!state,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("city")
        .eq("is_active", true)
        .eq("state", state!)
        .not("city", "is", null);
      if (error) throw error;
      const cities = [...new Set(data.map((u: any) => u.city as string))].sort();
      return cities;
    },
  });
}

export function useAvailableJobs() {
  return useQuery({
    queryKey: ["available_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title")
        .eq("is_active", true)
        .order("title");
      if (error) throw error;
      return data;
    },
  });
}

export function useStatesWithJobCount() {
  return useQuery({
    queryKey: ["states_with_job_count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("id, units!inner(state, is_franqueadora, is_active)")
        .eq("status", "aberta" as any);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((uj: any) => {
        if (!uj.units?.is_active || uj.units?.is_franqueadora || !uj.units?.state) return;
        counts[uj.units.state] = (counts[uj.units.state] || 0) + 1;
      });
      return Object.entries(counts)
        .map(([state, jobCount]) => ({ state, jobCount }))
        .sort((a, b) => a.state.localeCompare(b.state));
    },
  });
}

export function useCitiesWithJobCount(state: string | null) {
  return useQuery({
    queryKey: ["cities_with_job_count", state],
    enabled: !!state,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("id, units!inner(city, state, is_franqueadora, is_active)")
        .eq("status", "aberta" as any);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((uj: any) => {
        if (!uj.units?.is_active || uj.units?.is_franqueadora || uj.units?.state !== state || !uj.units?.city) return;
        counts[uj.units.city] = (counts[uj.units.city] || 0) + 1;
      });
      return Object.entries(counts)
        .map(([city, jobCount]) => ({ city, jobCount }))
        .sort((a, b) => a.city.localeCompare(b.city));
    },
  });
}
