import { supabase } from "@/integrations/supabase/client";
import { pipelineHasTestPhase } from "@/lib/testResolver";

/**
 * Retorna true quando o cargo possui ALGUM teste atribuído:
 *  - Regra 1: pipeline ativo com fase `phase_kind=avaliacao` executável.
 *  - Regra 2: existe `test_template` ativo cujo `job_ids` contém o cargo.
 *
 * Usado pela automação `auto_approve_test_if_not_exists` para decidir se
 * a etapa Teste deve ser pulada (vaga sem teste).
 */
export async function jobHasAnyTest(jobId: string): Promise<boolean> {
  try {
    const { hasTest } = await pipelineHasTestPhase(jobId);
    if (hasTest) return true;
  } catch (e) {
    console.error("[jobHasAnyTest] pipelineHasTestPhase failed:", e);
  }

  try {
    const { data } = await supabase
      .from("test_templates" as any)
      .select("id, job_ids, is_active")
      .eq("is_active", true);
    return (data || []).some((t: any) =>
      Array.isArray(t.job_ids) && t.job_ids.includes(jobId)
    );
  } catch (e) {
    console.error("[jobHasAnyTest] template lookup failed:", e);
    return false;
  }
}
