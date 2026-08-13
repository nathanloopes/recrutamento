import { supabase } from "@/integrations/supabase/client";
import { dispatchAutomationEvent } from "@/lib/automationEngine";

/**
 * After a candidate is marked as "contratado", check if the job's openings
 * are fully filled. If so, move remaining "aprovado" candidates to the
 * Talent Pool (status "standby") and mark the unit_job as "preenchida".
 *
 * Returns the number of candidates moved to standby, or 0 if job not yet full.
 */
export async function handleHiringCompleted(unitJobId: string): Promise<number> {
  // 1. Get unit_job openings and unit/job info
  const { data: unitJob, error: ujErr } = await supabase
    .from("unit_jobs")
    .select("id, openings, unit_id, job_id, status")
    .eq("id", unitJobId)
    .single();

  if (ujErr || !unitJob) {
    console.error("[JobFillEngine] Erro ao buscar unit_job:", ujErr);
    return 0;
  }

  // Skip if already filled or no openings defined
  if (unitJob.status === "preenchida" || unitJob.openings === null || unitJob.openings === undefined || unitJob.openings <= 0) {
    return 0;
  }

  // 2. Count hired candidates for this unit_job
  const { count: hiredCount, error: countErr } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("unit_job_id", unitJobId)
    .eq("status", "contratado");

  if (countErr || hiredCount === null) {
    console.error("[JobFillEngine] Erro ao contar contratados:", countErr);
    return 0;
  }

  // 3. If not yet filled, return
  if (hiredCount < unitJob.openings) {
    return 0;
  }

  // 4. Job is filled — fetch approved candidates
  const { data: approvedApps, error: appErr } = await supabase
    .from("applications")
    .select("id, candidate_id")
    .eq("unit_job_id", unitJobId)
    .eq("status", "aprovado");

  if (appErr) {
    console.error("[JobFillEngine] Erro ao buscar aprovados:", appErr);
    return 0;
  }

  if (!approvedApps || approvedApps.length === 0) {
    // No approved candidates to move, just mark job as filled
    await supabase
      .from("unit_jobs")
      .update({ status: "preenchida" })
      .eq("id", unitJobId);
    return 0;
  }

  // 5. Move each approved candidate to standby + update talent pool
  const candidateIds = approvedApps.map((a) => a.candidate_id);
  const applicationIds = approvedApps.map((a) => a.id);

  // Batch update applications → standby
  await supabase
    .from("applications")
    .update({ status: "standby" } as any)
    .in("id", applicationIds);

  // Batch update talent_pool_entries
  await supabase
    .from("talent_pool_entries")
    .update({
      status: "active",
      last_job_id: unitJob.job_id,
      origin_unit_id: unitJob.unit_id,
      last_interaction: new Date().toISOString(),
    } as any)
    .in("candidate_id", candidateIds);

  // 6. Send notification to each candidate
  const notifications = candidateIds.map((cid) => ({
    recipient_id: cid,
    event_type: "talent_pool_auto_added",
    channel: "in_app",
    title: "Você foi adicionado ao Banco de Talentos",
    body: "A vaga foi preenchida, mas seu perfil foi aprovado e está disponível para novas oportunidades.",
    status: "pending",
    action_url: "/candidaturas",
    action_type: "info",
  }));

  await supabase.from("notifications").insert(notifications);

  // 7. Mark unit_job as filled
  await supabase
    .from("unit_jobs")
    .update({ status: "preenchida" })
    .eq("id", unitJobId);

  // 8. Audit trail
  const { data: session } = await supabase.auth.getSession();
  const actorId = session.session?.user?.id;

  if (actorId) {
    await supabase.from("audit_trail").insert({
      actor_id: actorId,
      action: "job_filled_auto_standby",
      target_type: "unit_job",
      target_id: unitJobId,
      context: {
        hired_count: hiredCount,
        openings: unitJob.openings,
        candidates_moved: candidateIds.length,
        candidate_ids: candidateIds,
      },
    });
  }

  // 9. Log in activity_logs
  await supabase.from("activity_logs").insert({
    action: "vaga_preenchida",
    module: "recrutamento",
    details: {
      unit_job_id: unitJobId,
      candidates_moved_to_talent_pool: candidateIds.length,
    },
  } as any);

  // 10. Dispatch automation event
  await dispatchAutomationEvent("job_filled", {
    unit_job_id: unitJobId,
    hired_count: hiredCount,
    candidates_moved: candidateIds.length,
  });

  console.log(
    `[JobFillEngine] Vaga ${unitJobId} preenchida. ${candidateIds.length} candidato(s) movido(s) ao Banco de Talentos.`
  );

  return candidateIds.length;
}

/**
 * After a hired candidate is removed (status changed from "contratado" to something else),
 * apply the given decision to the job: "aberta" (reopen) or "pausada" (pause).
 * Only acts if the job is currently "preenchida" and hired count dropped below openings.
 */
export async function handleHiringReverted(
  unitJobId: string,
  decision: "aberta" | "pausada" = "aberta"
): Promise<void> {
  const { data: unitJob, error: ujErr } = await supabase
    .from("unit_jobs")
    .select("id, openings, status")
    .eq("id", unitJobId)
    .single();

  if (ujErr || !unitJob) return;

  // Only act if currently "preenchida"
  if (unitJob.status !== "preenchida") return;

  const { count: hiredCount } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("unit_job_id", unitJobId)
    .eq("status", "contratado");

  // If hired is now below openings, apply the decision
  if ((hiredCount || 0) < (unitJob.openings || 1)) {
    await supabase
      .from("unit_jobs")
      .update({ status: decision })
      .eq("id", unitJobId);

    const { data: session } = await supabase.auth.getSession();
    const actorId = session.session?.user?.id;

    if (actorId) {
      await supabase.from("audit_trail").insert({
        actor_id: actorId,
        action: decision === "aberta" ? "job_reopened_after_revert" : "job_paused_after_dismissal",
        target_type: "unit_job",
        target_id: unitJobId,
        context: {
          hired_count: hiredCount || 0,
          openings: unitJob.openings,
          decision,
        },
      });
    }

    await supabase.from("activity_logs").insert({
      action: decision === "aberta" ? "vaga_reaberta" : "vaga_pausada",
      module: "recrutamento",
      details: { unit_job_id: unitJobId, reason: "contratado_revertido", decision },
    } as any);

    console.log(`[JobFillEngine] Vaga ${unitJobId} ${decision === "aberta" ? "reaberta" : "pausada"} após reversão de contratação.`);
  }
}
