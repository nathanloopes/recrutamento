import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches benefits for a unit_job from the normalized `job_benefits` table.
 * Falls back to the JSONB `benefits` field on `unit_jobs` if no normalized records exist.
 */
export function useJobBenefitsBatch(unitJobIds: string[]) {
  return useQuery({
    queryKey: ["job_benefits_batch", unitJobIds],
    enabled: unitJobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_benefits")
        .select("unit_job_id, name, category, description")
        .in("unit_job_id", unitJobIds);
      if (error) throw error;

      // Group by unit_job_id
      const map: Record<string, string[]> = {};
      for (const row of data || []) {
        if (!map[row.unit_job_id]) map[row.unit_job_id] = [];
        map[row.unit_job_id].push(row.name);
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Resolves benefits for a unit_job: prefers normalized table, falls back to JSONB.
 */
export function resolveBenefits(
  ujId: string,
  ujBenefitsJsonb: any,
  normalizedMap?: Record<string, string[]>
): string[] {
  if (normalizedMap && normalizedMap[ujId] && normalizedMap[ujId].length > 0) {
    return normalizedMap[ujId];
  }
  return Array.isArray(ujBenefitsJsonb) ? ujBenefitsJsonb : [];
}
