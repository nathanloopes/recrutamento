import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna as vagas ABERTAS do MESMO cargo (`job_id`) em OUTRAS unidades,
 * excluindo a `unit_job` atual. Base para oferecer "a mesma vaga em outra
 * unidade" quando a vaga do candidato deixa de estar disponível.
 *
 * "Mesma vaga" = mesmo `unit_jobs.job_id` (padrão usado em todo o app).
 */
export function useEquivalentOpenJobs(jobId?: string | null, excludeUnitJobId?: string | null) {
  return useQuery({
    queryKey: ["equivalent_open_jobs", jobId, excludeUnitJobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("id, job_id, unit_id, status, units!inner(id, name, city, state, is_active)")
        .eq("status", "aberta" as any)
        .eq("job_id", jobId!)
        .eq("units.is_active", true);
      if (error) throw error;
      return (data || []).filter((uj: any) => uj.id !== excludeUnitJobId);
    },
  });
}
