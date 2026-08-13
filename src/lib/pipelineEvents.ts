import { supabase } from "@/integrations/supabase/client";

/**
 * Increment pipeline version when structural changes are made.
 * Non-blocking — errors are logged but don't break the flow.
 */
export async function incrementPipelineVersion(pipelineId: string) {
  try {
    const { data } = await supabase
      .from("job_pipelines")
      .select("version")
      .eq("id", pipelineId)
      .single();
    const currentVersion = (data as any)?.version || 1;
    await supabase
      .from("job_pipelines")
      .update({ version: currentVersion + 1 } as any)
      .eq("id", pipelineId);
  } catch (e) {
    console.error("[Pipelines] Failed to increment version:", e);
  }
}

/**
 * Send pipeline event notifications to relevant users.
 * Non-blocking — errors are logged but don't break the flow.
 */
export async function sendPipelineNotification(
  event: "onPhaseCompleted" | "onPhaseFailed" | "onHighScore" | "onPipelineVersionChange" | "onEscalation",
  context: {
    candidateId?: string;
    pipelineName?: string;
    phaseName?: string;
    score?: number;
    jobId?: string;
  }
) {
  try {
    const messages: Record<string, { title: string; message: string }> = {
      onPhaseCompleted: {
        title: "Etapa concluída",
        message: `Você avançou para a próxima etapa do processo.`,
      },
      onPhaseFailed: {
        title: "Candidatura em análise",
        message: `Sua candidatura está em análise. Em breve a unidade retorna com mais informações.`,
      },
      onHighScore: {
        title: "Destaque: Score alto",
        message: `Candidato atingiu score ${context.score} no pipeline "${context.pipelineName}". Marcado como destaque.`,
      },
      onPipelineVersionChange: {
        title: "Pipeline atualizado",
        message: `O pipeline "${context.pipelineName}" foi atualizado estruturalmente. Verifique as mudanças.`,
      },
      onEscalation: {
        title: "Escalação: revisão humana necessária",
        message: `Candidato ficou próximo do score mínimo na fase "${context.phaseName}" do pipeline "${context.pipelineName}" (score: ${context.score}). Requer análise humana.`,
      },
    };


    const { title, message } = messages[event];

    // pipeline_version_change: notificação desativada — apenas auditoria via activity_logs.

    // Notificar candidato APENAS em eventos neutros (sem expor score).
    // onHighScore é uso interno (destaque admin) — não envia ao candidato.
    if ((event === "onPhaseCompleted" || event === "onPhaseFailed") && context.candidateId) {
      await supabase.from("notifications").insert({
        event_type: `pipeline_${event.replace("on", "").toLowerCase()}`,
        recipient_id: context.candidateId,
        channel: "push",
        title,
        body: message,
        status: "pending",
      } as any);
    }


    // Log the event
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert({
      user_id: userData.user?.id || null,
      action: `pipeline_event_${event}`,
      module: "pipelines",
      details: context,
    } as any);
  } catch (e) {
    console.error(`[Pipelines] Failed to send ${event} notification:`, e);
  }
}
