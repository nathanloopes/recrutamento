import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Visibilidade de vagas (v6.2):
 * Uma vaga só é exibida ao candidato se o cargo (job_id) tiver pipeline ATIVO.
 * Templates de teste sozinhos NÃO tornam uma vaga visível — eles atuam apenas
 * como conteúdo dentro das fases de avaliação do pipeline.
 */
export function useJobsWithTests() {
  return useQuery({
    queryKey: ["jobs_with_tests"],
    staleTime: 30000,
    queryFn: async () => {
      const { data: pipelines, error } = await supabase
        .from("job_pipelines")
        .select("job_id")
        .eq("is_active", true);
      if (error) throw error;

      const allIds = new Set<string>();
      const specificIds = new Set<string>();
      (pipelines || []).forEach((p: any) => {
        allIds.add(p.job_id);
        specificIds.add(p.job_id);
      });

      // hasGlobalTemplate sempre falso — mantido na shape para compatibilidade de callers
      return { jobIdsWithTest: allIds, hasGlobalTemplate: false, jobIdsWithSpecificTest: specificIds };
    },
  });
}

/** Vaga visível ao candidato APENAS se o cargo tem pipeline ativo */
export function jobHasTest(
  jobId: string | undefined,
  data: { jobIdsWithTest: Set<string>; hasGlobalTemplate: boolean; jobIdsWithSpecificTest: Set<string> } | undefined
): boolean {
  if (!jobId || !data) return true; // assume yes while loading para evitar flicker
  return data.jobIdsWithTest.has(jobId);
}

/** Para badges admin: idêntico — pipeline ativo é a única fonte de visibilidade */
export function jobHasSpecificTest(
  jobId: string | undefined,
  data: { jobIdsWithTest: Set<string>; hasGlobalTemplate: boolean; jobIdsWithSpecificTest: Set<string> } | undefined
): boolean {
  if (!jobId || !data) return true;
  return data.jobIdsWithSpecificTest.has(jobId);
}
