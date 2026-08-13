import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Gate de envio de documentos: o candidato só pode enviar documentos
 * após aprovação para a fase de documentação. Fontes válidas de aprovação:
 *
 * 1. Decisão humana registrada em `interview_feedback` (`aprovado`/`presencial`)
 *    em entrevista `completed` — fluxo canônico.
 * 2. `applications.status ∈ ('aprovado','contratado')` — candidato já foi
 *    promovido, independente da trilha.
 * 3. Fase atual da candidatura é do tipo `documentacao` — o recrutador colocou
 *    o candidato explicitamente nessa etapa (ex: "Convidar para retomar" em
 *    modo Documentação a partir do standby).
 *
 * Se nenhum desses sinais existir E nenhuma entrevista não-cancelada estiver
 * registrada, o gate permanece bloqueado.
 */
export function useInterviewApprovalGate(applicationId?: string) {
  return useQuery({
    queryKey: ["interview_approval_gate", applicationId],
    enabled: !!applicationId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      // 1) Estado da candidatura + tipo da fase atual
      const { data: app } = await supabase
        .from("applications")
        .select("id, status, current_phase, pipeline_phases:current_phase(phase_kind)")
        .eq("id", applicationId!)
        .maybeSingle();

      const status = String((app as any)?.status || "").toLowerCase();
      if (status === "aprovado" || status === "contratado") {
        return { required: true, approved: true, blocked: false };
      }

      const phaseKind = String(
        (app as any)?.pipeline_phases?.phase_kind || ""
      ).toLowerCase();
      if (phaseKind === "documentacao") {
        return { required: true, approved: true, blocked: false };
      }

      // 2) Fluxo canônico via interview_feedback
      const { data: interviews } = await supabase
        .from("interviews")
        .select("id, status")
        .eq("application_id", applicationId!);

      const nonCancelled = (interviews || []).filter(
        (i: any) => i.status !== "cancelled"
      );
      if (nonCancelled.length === 0) {
        return { required: true, approved: false, blocked: true };
      }

      let humanApproved = false;
      const completedIds = nonCancelled
        .filter((i: any) => i.status === "completed")
        .map((i: any) => i.id);
      if (completedIds.length > 0) {
        const { data: feedback } = await supabase
          .from("interview_feedback")
          .select("decision")
          .in("interview_id", completedIds);
        humanApproved = (feedback || []).some((f: any) => {
          const d = String(f.decision || "").toLowerCase();
          return d === "presencial" || d === "aprovado";
        });
      }

      const approved = humanApproved;
      return { required: true, approved, blocked: !approved };
    },
  });
}
