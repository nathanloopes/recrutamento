/**
 * Visão operacional do pipeline de um cargo.
 *
 * Regra de negócio (atualizada):
 *   - Cada cargo tem NO MÁXIMO 1 pipeline ativo (enforce via índice único
 *     parcial em `job_pipelines` + trigger). Pipelines inativos são rascunhos.
 *   - Pipeline ativo SEMPRE tem ao menos uma fase (trigger
 *     `ensure_pipeline_has_phases_before_activate`).
 *
 * Esta função devolve o único pipeline ativo do cargo (ou null), já com
 * as fases ativas ordenadas funcionalmente:
 *
 *   triagem → avaliacao → entrevista → avaliacao_pos_entrevista
 *           → documentacao → resultado
 *
 * Mantém o shape `OperationalPipeline` que consumidores antigos esperam.
 */
import { supabase } from "@/integrations/supabase/client";

const PHASE_KIND_ORDER: Record<string, number> = {
  triagem: 0,
  avaliacao: 1,
  entrevista: 2,
  avaliacao_pos_entrevista: 3,
  documentacao: 4,
  resultado: 5,
};

function phaseKindRank(kind: string | null | undefined): number {
  const k = (kind || "avaliacao").toLowerCase();
  return PHASE_KIND_ORDER[k] ?? 1;
}

export interface OperationalPipeline {
  id: string;
  job_id: string;
  name: string;
  is_active: true;
  pipeline_phases: any[];
  /** Sempre contém 1 elemento na nova regra (mantido p/ compat). */
  source_pipeline_ids: string[];
}

/**
 * Carrega o ÚNICO pipeline ativo do cargo (ou null).
 *
 * @param stepsSelect colunas a selecionar de `pipeline_steps`. O default
 *   inclui `content` (necessário para detectar perguntas executáveis).
 */
export async function loadOperationalPipeline(
  jobId: string,
  stepsSelect = "id, type, content, title, weight, order_index, conditions, is_optional, is_automated, phase_id"
): Promise<OperationalPipeline | null> {
  const { data: pipelines, error } = await supabase
    .from("job_pipelines")
    .select(
      `id, name, job_id, is_active, version, created_at,
       pipeline_phases(
         id, name, order_index, min_score, phase_type, phase_kind, is_active, pipeline_id,
         pipeline_steps(${stepsSelect})
       )`
    )
    .eq("job_id", jobId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[operationalPipeline] load error:", error);
    return null;
  }

  const pipeline = (pipelines || [])[0] as any;
  if (!pipeline) return null;

  const phases: any[] = [];
  for (const ph of (pipeline.pipeline_phases || [])) {
    if (ph.is_active === false) continue;
    const steps = (ph.pipeline_steps || []).slice().sort(
      (a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0)
    );
    phases.push({ ...ph, pipeline_steps: steps });
  }

  phases.sort((a, b) => {
    const ka = phaseKindRank(a.phase_kind);
    const kb = phaseKindRank(b.phase_kind);
    if (ka !== kb) return ka - kb;
    return (a.order_index ?? 0) - (b.order_index ?? 0);
  });

  return {
    id: pipeline.id,
    job_id: jobId,
    name: pipeline.name,
    is_active: true,
    pipeline_phases: phases,
    source_pipeline_ids: [pipeline.id],
  };
}
