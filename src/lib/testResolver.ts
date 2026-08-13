import { supabase } from "@/integrations/supabase/client";
import { findPipelineTestPhase } from "@/lib/pipelinePhaseDetector";
import { loadOperationalPipeline } from "@/lib/operationalPipeline";
import { fetchPostInterviewTestUnlocked } from "@/lib/releasePostInterviewTest";

/**
 * Regra oficial de liberação de testes (Pipeline x Módulo Testes):
 *
 *  1) Pipeline tem fase `phase_kind = 'avaliacao'` com pelo menos um step
 *     com perguntas executáveis → abre o teste do Pipeline em
 *     /triagem/{appId}. Testes vinculados à vaga (test_templates) são
 *     IGNORADOS — ficam reservados para envio manual do recrutador.
 *  2) Pipeline NÃO tem fase de teste → busca/cria test_assignment a partir
 *     de test_template ativo cujo job_ids contém o cargo. Abre /testes/{id}.
 *  3) Nenhum dos dois → kind 'none'.
 *
 * A detecção de "fase de teste" mora em src/lib/pipelinePhaseDetector.ts
 * — fonte única compartilhada com useApplicationStatus.
 */

export type ResolvedTest =
  | { kind: "pipeline"; actionUrl: string; phaseId: string }
  | { kind: "job_template"; actionUrl: string; assignmentId: string }
  | { kind: "none" };

/**
 * Detecta se o pipeline ativo do cargo contém uma fase de teste real.
 * Pipeline-first: se sim, o teste do pipeline é o oficial e roda em
 * /triagem/{appId} usando o mesmo renderer e o mesmo motor de score do
 * módulo Testes.
 */
export async function pipelineHasTestPhase(jobId: string): Promise<{
  hasTest: boolean;
  testPhaseId: string | null;
  phaseKind: string | null;
}> {
  const op = await loadOperationalPipeline(jobId);
  const testPhase = findPipelineTestPhase(op?.pipeline_phases || []);

  return {
    hasTest: !!testPhase,
    testPhaseId: (testPhase as any)?.id || null,
    phaseKind: (testPhase as any)?.phase_kind || null,
  };
}


/**
 * Resolve o destino do botão "Ver testes da vaga" / "Realizar teste".
 * Idempotente: cria test_assignment somente quando necessário (Regra 2).
 */
export async function resolveAvailableTest(
  applicationId: string,
  jobId: string,
  candidateId?: string
): Promise<ResolvedTest> {
  // Regra 1: pipeline manda
  const { hasTest, testPhaseId, phaseKind } = await pipelineHasTestPhase(jobId);
  if (hasTest && testPhaseId) {
    // Gate: teste pós-entrevista só libera após entrevista aprovada e sem
    // entrevista ativa pendente. Caso contrário, o botão não deve abrir o
    // wizard — devolve 'none' e o caller cai para /candidaturas.
    if (phaseKind === "avaliacao_pos_entrevista") {
      const unlocked = await fetchPostInterviewTestUnlocked(applicationId);
      if (!unlocked) {
        console.debug("[testResolver] kind=none: teste pós-entrevista bloqueado pelo gate", {
          applicationId,
          jobId,
        });
        return { kind: "none" };
      }
    }
    return {
      kind: "pipeline",
      actionUrl: `/triagem/${applicationId}`,
      phaseId: testPhaseId,
    };
  }

  // Regra 2: tenta achar assignment ativo
  const { data: existing } = await supabase
    .from("test_assignments" as any)
    .select("id")
    .eq("application_id", applicationId)
    .in("status", ["pendente", "em_andamento"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((existing as any)?.id) {
    return {
      kind: "job_template",
      actionUrl: `/testes/${(existing as any).id}`,
      assignmentId: (existing as any).id,
    };
  }

  // Sem assignment: tenta criar a partir de template vinculado à vaga
  const { data: templates } = await supabase
    .from("test_templates" as any)
    .select("id, job_ids, is_active")
    .eq("is_active", true);

  const matched = (templates || []).find((t: any) => {
    const ids = Array.isArray(t.job_ids) ? t.job_ids : [];
    return ids.includes(jobId);
  });

  if (!matched) {
    console.debug("[testResolver] kind=none: pipeline sem fase de avaliação com perguntas E sem test_template vinculado", { jobId, applicationId });
    return { kind: "none" };
  }

  let resolvedCandidateId = candidateId;
  if (!resolvedCandidateId) {
    const { data: app } = await supabase
      .from("applications")
      .select("candidate_id")
      .eq("id", applicationId)
      .maybeSingle();
    resolvedCandidateId = (app as any)?.candidate_id;
  }
  if (!resolvedCandidateId) return { kind: "none" };

  // Liberação automática (assigned_by = null) — não é envio manual do recrutador.
  // Idempotência: o trigger DB também garante isso, mas mantemos cliente-side
  // por compatibilidade caso o trigger não execute (best-effort).
  const { data: created, error } = await supabase
    .from("test_assignments" as any)
    .insert({
      test_template_id: (matched as any).id,
      application_id: applicationId,
      candidate_id: resolvedCandidateId,
      assigned_by: null,
      status: "pendente",
      is_mandatory: true,
    } as any)
    .select("id")
    .maybeSingle();

  if (error || !(created as any)?.id) {
    // Se a inserção falhou (provavelmente porque o trigger já criou), busca de novo.
    const { data: retry } = await supabase
      .from("test_assignments" as any)
      .select("id")
      .eq("application_id", applicationId)
      .in("status", ["pendente", "em_andamento"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((retry as any)?.id) {
      return {
        kind: "job_template",
        actionUrl: `/testes/${(retry as any).id}`,
        assignmentId: (retry as any).id,
      };
    }
    return { kind: "none" };
  }

  return {
    kind: "job_template",
    actionUrl: `/testes/${(created as any).id}`,
    assignmentId: (created as any).id,
  };
}
