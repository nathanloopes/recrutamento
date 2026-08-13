import { supabase } from "@/integrations/supabase/client";
import { loadOperationalPipeline } from "@/lib/operationalPipeline";
import { jobHasAnyTest } from "@/lib/jobHasAnyTest";

function isEnabledSetting(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    try {
      return isEnabledSetting(JSON.parse(raw));
    } catch (_) {
      return false;
    }
  }
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    return value.enabled === true || value.value === true;
  }
  return false;
}

async function isPipelineAutoApproveEnabled(): Promise<boolean> {
  const { data: setting } = await supabase
    .from("global_settings" as any)
    .select("value")
    .eq("category", "pipelines")
    .eq("key", "auto_approve_test_if_not_exists")
    .maybeSingle();
  return isEnabledSetting((setting as any)?.value);
}

/**
 * Avança o pipeline de uma candidatura logo após a escolha da unidade.
 *
 * Regra (v6.2 — corrigida):
 *  - Usa o pipeline OPERACIONAL (mescla de todos os pipelines ativos do
 *    cargo). Isso garante que a primeira fase pós-triagem seja encontrada
 *    mesmo quando ela vive em um SEGUNDO pipeline ativo separado da
 *    triagem.
 *  - Se há fase pós-triagem, grava em `applications.current_phase` e seta
 *    status `em_andamento`.
 *  - Se não há fase pós-triagem, mantém a fase atual mas garante status
 *    `em_andamento`.
 *  - Best-effort: nunca lança para não quebrar o fluxo de candidatura.
 */
export async function advanceAfterUnitChoice(applicationId: string) {
  try {
    const { data: app } = await supabase
      .from("applications")
      .select("id, status, current_phase, origin_link_id, unit_jobs(job_id)")
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) return;

    const blocked = ["aprovado", "contratado", "reprovado", "standby", "desistente"];
    if (blocked.includes((app as any).status)) return;

    // Candidaturas via link direto (/v/:token) NÃO podem pular triagem.
    // O link só substitui a escolha de unidade — a triagem do cargo
    // continua obrigatória e é feita dentro da própria candidatura.
    if ((app as any).origin_link_id) return;

    const jobId = (app as any).unit_jobs?.job_id;
    if (!jobId) return;

    const op = await loadOperationalPipeline(jobId);
    const phases = op?.pipeline_phases || [];

    const firstPostTriage = phases.find(
      (p: any) => (p.phase_kind || "avaliacao") !== "triagem"
    );

    const updates: any = { status: "em_andamento" };
    if (firstPostTriage) {
      updates.current_phase = firstPostTriage.id;
    }

    await supabase
      .from("applications")
      .update(updates)
      .eq("id", applicationId);

    if (firstPostTriage) {
      await supabase.rpc("log_application_journey" as any, {
        p_application_id: applicationId,
        p_event_type: "phase_skipped",
        p_skipped: true,
        p_skip_reason: "triage_skipped_after_unit_choice",
        p_phase_id: (app as any).current_phase ?? null,
        p_actor_role: "system",
        p_source: "system",
        p_details: { jumped_to_phase_id: firstPostTriage.id } as any,
      } as any);
    }
  } catch (e) {
    console.error("[pipelineProgression] advanceAfterUnitChoice failed:", e);
  }
}

/**
 * Auto-aprova a etapa de teste quando o flag está ligado e o score já
 * registrado para a candidatura/candidato atinge o min_score institucional
 * do cargo. Cobre o fluxo ACATO em que o teste do cargo acontece antes da
 * escolha da unidade e o score é copiado para `applications.total_score`.
 */
export async function autoApproveTestByScore(applicationId: string): Promise<{ approved: boolean; score?: number; minScore?: number }> {
  try {
    if (!(await isPipelineAutoApproveEnabled())) return { approved: false };

    const { data: app } = await supabase
      .from("applications" as any)
      .select("id, status, candidate_id, total_score, unit_jobs(job_id, jobs(min_score))")
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) return { approved: false };

    const status = (app as any).status;
    if (!["pendente", "em_andamento", "em_avaliacao"].includes(status)) return { approved: false };

    const jobId = (app as any).unit_jobs?.job_id;
    const minScore = Number((app as any).unit_jobs?.jobs?.min_score ?? 0);
    let score = (app as any).total_score == null ? null : Number((app as any).total_score);

    if ((score == null || Number.isNaN(score)) && (app as any).candidate_id) {
      const { data: talentEntry } = await supabase
        .from("talent_pool_entries" as any)
        .select("test_score, last_job_id")
        .eq("candidate_id", (app as any).candidate_id)
        .maybeSingle();
      const sameJob = !jobId || !(talentEntry as any)?.last_job_id || (talentEntry as any).last_job_id === jobId;
      if (sameJob && (talentEntry as any)?.test_score != null) {
        score = Number((talentEntry as any).test_score);
      }
    }

    if (score == null || Number.isNaN(score) || score < minScore) {
      return { approved: false, score: score ?? undefined, minScore };
    }

    const { error: updateErr } = await supabase
      .from("applications" as any)
      .update({ status: "aprovado" } as any)
      .eq("id", applicationId);
    if (updateErr) {
      console.error("[autoApproveTestByScore] update failed:", updateErr);
      return { approved: false, score, minScore };
    }

    await supabase.from("activity_logs" as any).insert({
      user_id: (app as any).candidate_id,
      action: "auto_test_approval",
      module: "pipelines",
      details: {
        application_id: applicationId,
        job_id: jobId,
        score,
        min_score: minScore,
        reason: "score_meets_min",
        triggered_by: "unit_choice_score_gate",
      },
    } as any);

    await supabase.rpc("log_application_journey" as any, {
      p_application_id: applicationId,
      p_event_type: "phase_skipped",
      p_skipped: true,
      p_skip_reason: "auto_approve_score_meets_min",
      p_score: score,
      p_actor_role: "system",
      p_source: "system",
      p_details: { job_id: jobId, min_score: minScore } as any,
    } as any);

    return { approved: true, score, minScore };
  } catch (e) {
    console.error("[pipelineProgression] autoApproveTestByScore failed:", e);
    return { approved: false };
  }
}

/**
 * Auto-aprova a etapa Teste quando:
 *  - global_settings(category=pipelines, key=auto_approve_test_if_not_exists) = true
 *  - a vaga não possui NENHUM teste (nem fase de pipeline, nem template)
 *
 * Idempotente: só age sobre status `pendente`/`em_andamento`. Best-effort:
 * nunca lança. Registra `activity_logs(action='auto_test_approval')` e envia
 * notificação informativa (não é "aprovação falsa": é liberação por ausência
 * de teste).
 */
const autoApproveAttempted = new Set<string>();

export async function autoApproveIfNoTest(applicationId: string) {
  if (autoApproveAttempted.has(applicationId)) return;
  autoApproveAttempted.add(applicationId);
  try {
    const { data: app } = await supabase
      .from("applications")
      .select("id, status, total_score, candidate_id, unit_jobs(job_id, jobs(min_score))")
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) return;

    const status = (app as any).status;
    if (status !== "em_andamento" && status !== "pendente" && status !== "em_avaliacao") return;

    const jobId = (app as any).unit_jobs?.job_id;
    if (!jobId) return;

    if (!(await isPipelineAutoApproveEnabled())) return;

    if (await jobHasAnyTest(jobId)) return;

    // O trigger `enforce_min_score_on_applications` rejeita aprovações
    // quando total_score < min_score. Como aqui o cargo não tem teste,
    // não há score real para comparar — preenchemos com o min_score do
    // cargo para satisfazer o trigger sem mudar a semântica.
    const minScore = Number((app as any).unit_jobs?.jobs?.min_score ?? 0);
    const currentScore = (app as any).total_score == null ? null : Number((app as any).total_score);
    const updatePayload: any = { status: "aprovado" };
    if (currentScore == null || currentScore < minScore) {
      updatePayload.total_score = minScore;
    }

    const { error: updateErr } = await supabase
      .from("applications")
      .update(updatePayload)
      .eq("id", applicationId);
    if (updateErr) {
      console.error("[autoApproveIfNoTest] update failed:", updateErr);
      return;
    }


    await supabase.from("activity_logs").insert({
      action: "auto_test_approval",
      module: "pipelines",
      details: {
        application_id: applicationId,
        job_id: jobId,
        reason: "no_test_attached",
        triggered_by: "unit_choice",
      },
    } as any);

    await supabase.rpc("log_application_journey" as any, {
      p_application_id: applicationId,
      p_event_type: "phase_skipped",
      p_skipped: true,
      p_skip_reason: "auto_approve_no_test",
      p_actor_role: "system",
      p_source: "system",
      p_details: { job_id: jobId } as any,
    } as any);

    const candidateId = (app as any).candidate_id;
    if (candidateId) {
      await supabase.from("notifications" as any).insert({
        user_id: candidateId,
        type: "candidate_under_evaluation",
        title: "Etapa de entrevista liberada",
        message: "Sua vaga não possui teste. Você foi liberado para a próxima etapa.",
        data: { application_id: applicationId, reason: "no_test_attached" },
      } as any);
    }
  } catch (e) {
    console.error("[pipelineProgression] autoApproveIfNoTest failed:", e);
  }
}
