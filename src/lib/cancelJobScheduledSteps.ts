import { supabase } from "@/integrations/supabase/client";

/**
 * Cancela, em cascata, todas as ETAPAS FUTURAS ainda pendentes das candidaturas
 * ativas de uma vaga (`unit_job_id`) quando ela deixa de estar `aberta`.
 *
 * Reaproveita o mesmo padrão do cascade de desistência (useWithdrawApplication)
 * e do standby-por-vaga (useCandidatesByJob), ampliando a cobertura para:
 *   - testes pós-entrevista (test_assignments pendente/em_andamento)
 *   - documentos (document_requests open/in_progress)
 *   - entrevistas E bate-papos pós-teste (mesma tabela `interviews`, o `purpose`
 *     distingue) nos status confirmed/rescheduled/pending_approval/reschedule_requested
 *   - notificações ainda pendentes/enfileiradas daquela candidatura
 * e move a candidatura para `standby` (preservando o histórico).
 *
 * NÃO remove histórico — apenas cancela o que ainda não aconteceu.
 * Idempotente: só toca linhas ainda ativas/pendentes, então é seguro rodar
 * mais de uma vez para a mesma vaga.
 *
 * Lembretes de entrevista são on-the-fly (o cron `interview-reminders` só
 * considera status `confirmed`), então cancelar a entrevista já os interrompe —
 * não há linha de lembrete a apagar.
 */

const ACTIVE_APP_STATUSES = ["pendente", "em_andamento", "em_avaliacao", "aprovado"];

export async function cancelScheduledStepsForUnitJob(
  unitJobId: string,
  opts: { reason: string },
): Promise<{ affectedApplications: number }> {
  // Candidaturas ATIVAS desta vaga (terminais e histórico ficam intocados).
  const { data: apps, error: appsErr } = await supabase
    .from("applications")
    .select("id, candidate_id")
    .eq("unit_job_id", unitJobId)
    .in("status", ACTIVE_APP_STATUSES);
  if (appsErr) throw appsErr;
  if (!apps || apps.length === 0) return { affectedApplications: 0 };

  await Promise.all(
    (apps as any[]).map(async (app) => {
      // Cancela agendamentos/pendências em paralelo.
      await Promise.all([
        supabase
          .from("test_assignments" as any)
          .update({ status: "cancelled" } as any)
          .eq("application_id", app.id)
          .in("status", ["pendente", "em_andamento"]),
        supabase
          .from("document_requests")
          .update({ status: "cancelled" })
          .eq("application_id", app.id)
          .in("status", ["open", "in_progress"]),
        // Entrevistas e bate-papos pós-teste vivem na MESMA tabela `interviews`.
        supabase
          .from("interviews")
          .update({ status: "cancelled" })
          .eq("application_id", app.id)
          .in("status", ["confirmed", "rescheduled", "pending_approval", "reschedule_requested"]),
      ]);

      // Notificações ainda não entregues desta candidatura.
      const { data: pendingNotifs } = await supabase
        .from("notifications")
        .select("id")
        .eq("recipient_id", app.candidate_id)
        .in("status", ["pending", "queued"])
        .contains("payload", { application_id: app.id } as any);
      if (pendingNotifs && pendingNotifs.length > 0) {
        await supabase
          .from("notifications")
          .update({ status: "cancelled" })
          .in("id", (pendingNotifs as any[]).map((n) => n.id));
      }

      // Move a candidatura para standby (não remove histórico).
      await supabase
        .from("applications")
        .update({ status: "standby", standby_reason: opts.reason } as any)
        .eq("id", app.id);
    }),
  );

  return { affectedApplications: apps.length };
}
