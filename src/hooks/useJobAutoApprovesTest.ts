import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { jobHasAnyTest } from "@/lib/jobHasAnyTest";

/**
 * Retorna true quando a configuração `auto_approve_test_if_not_exists` está
 * ativa E o cargo não possui NENHUM teste atribuído. Nesse caso, o recrutador
 * NÃO deve ver os botões manuais de Aprovar/Standby na etapa Teste — o sistema
 * libera automaticamente para a próxima fase.
 */
export function useJobAutoApprovesTest(jobId?: string | null) {
  const settingQuery = useQuery({
    queryKey: ["settings", "auto_approve_no_test"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("global_settings" as any)
        .select("value")
        .eq("category", "pipelines")
        .eq("key", "auto_approve_test_if_not_exists")
        .maybeSingle();
      const raw = (data as any)?.value;
      return raw === true || raw === "true";
    },
  });

  const enabled = settingQuery.data === true && !!jobId;

  const hasTestQuery = useQuery({
    queryKey: ["job_has_any_test", jobId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => (jobId ? await jobHasAnyTest(jobId) : true),
  });

  const autoApproves =
    settingQuery.data === true && !!jobId && hasTestQuery.data === false;

  return {
    autoApproves,
    isLoading: settingQuery.isLoading || (enabled && hasTestQuery.isLoading),
  };
}
