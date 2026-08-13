import { useState, useEffect } from "react";
import {
  DEFAULT_INTERVIEW_APPROVE_REASON as DEFAULT_APPROVE_REASON,
  DEFAULT_INTERVIEW_STANDBY_REASON as DEFAULT_STANDBY_REASON,
} from "@/lib/userMessages";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Loader2, FlaskConical } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateInterview } from "@/hooks/useScheduling";
import { useSendNotification } from "@/hooks/useNotifications";
import { useAutoRequestDocuments } from "@/hooks/useAutoRequestDocuments";
import { moveToStandby } from "@/lib/moveToStandby";
import { releasePostInterviewTest } from "@/lib/releasePostInterviewTest";

export interface InterviewDecisionTarget {
  interview: any; // expects { id, candidate_id, applications: { id, unit_jobs: { jobs: { id, title } } } }
  decision: "aprovado" | "standby";
}

interface Props {
  target: InterviewDecisionTarget | null;
  onOpenChange: (open: boolean) => void;
  onDone?: (interviewId: string) => void;
}

export function InterviewDecisionDialog({ target, onOpenChange, onDone }: Props) {
  const qc = useQueryClient();
  const updateInterview = useUpdateInterview();
  const sendNotification = useSendNotification();
  const autoRequestDocs = useAutoRequestDocuments();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isStandby = target?.decision === "standby";
  const isApprove = target?.decision === "aprovado";
  // Bate-papo = teste presencial (última etapa antes de Documentação). Aprovar
  // este item já cria automaticamente o checklist de documentos.
  const isBatePapo = target?.interview?.purpose === "bate_papo";

  useEffect(() => {
    if (target) {
      setReason(target.decision === "standby" ? DEFAULT_STANDBY_REASON : DEFAULT_APPROVE_REASON);
    }
  }, [target?.interview?.id, target?.decision]);

  const handleClose = (open: boolean) => {
    if (!open) {
      setReason("");
      onOpenChange(false);
    }
  };

  const handleConfirm = async () => {
    if (!target) return;
    const trimmed = reason.trim();
    if (isStandby && !trimmed) {
      toast.error("Mensagem obrigatória. Escreva o motivo que será exibido ao candidato.");
      return;
    }

    const iv = target.interview;
    const application = iv.applications;
    if (!application?.id) {
      toast.error("Candidatura associada não encontrada.");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Marcar entrevista como concluída
      await updateInterview.mutateAsync({ id: iv.id, status: "completed" });

      // 1b. Registrar decisão em interview_feedback
      // O banco aceita `presencial` como decisão de aprovação humana.
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser?.id) {
        const { error: feedbackError } = await supabase.from("interview_feedback").upsert({
          interview_id: iv.id,
          evaluator_id: currentUser.id,
          decision: isStandby ? "standby" : "presencial",
          notes: trimmed || null,
        }, { onConflict: "interview_id" });
        if (feedbackError) throw feedbackError;
      }

      // 2. Atualizar status da candidatura
      const updatePayload: any = { status: isStandby ? "standby" : "aprovado" };
      if (isStandby) updatePayload.standby_reason = trimmed || null;
      await supabase.from("applications").update(updatePayload).eq("id", application.id);

      // 2b. Standby → mover para banco de talentos
      if (isStandby) {
        const jobId = application?.unit_jobs?.jobs?.id;
        await moveToStandby(iv.candidate_id, trimmed || "Entrevista — standby", jobId);
      }

      // Log de justificativa
      if (trimmed) {
        await supabase.from("activity_logs").insert({
          action: "interview_decision_justified",
          module: "entrevistas",
          details: { interview_id: iv.id, decision: target.decision, justification: trimmed, application_id: application.id },
        } as any);
      }

      // 3. Notificação ao candidato
      const jobTitle = application?.unit_jobs?.jobs?.title || "";
      if (isApprove) {
        if (isBatePapo) {
          // 3a-bp. Última etapa antes da Documentação → cria checklist de docs
          // automaticamente e dispara a notificação canônica `documents_requested`
          // (o hook cuida do dedup e não cria em duplicata). Não chama
          // releasePostInterviewTest — bate-papo já é POS-teste.
          try {
            const result = await autoRequestDocs.mutateAsync({
              application: {
                id: application.id,
                candidate_id: iv.candidate_id,
                profiles: application?.profiles || null,
              },
              unitJob: application?.unit_jobs || {},
            });
            if (result.created) {
              toast.success("Aprovado! Solicitação de documentos enviada ao candidato.");
            } else {
              toast.info("Aprovado. Solicitação de documentos já existente — não foi criada uma nova.");
            }
          } catch (e: any) {
            // A aprovação em si já aconteceu; só avisamos que o auto-request falhou.
            console.error("[InterviewDecisionDialog] auto-request documents failed", e);
            toast.warning(
              e?.message ||
                "Candidato aprovado, mas a solicitação automática de documentos falhou. Envie manualmente pelo botão 'Solicitar documentos'.",
            );
          }
        } else {
          // 3a. Entrevista comum: libera teste pós-entrevista (no-op se unidade sem teste)
          let releaseInfo: Awaited<ReturnType<typeof releasePostInterviewTest>> | null = null;
          try {
            releaseInfo = await releasePostInterviewTest(application.id);
            if (releaseInfo && releaseInfo.released === false) {
              if (releaseInfo.reason === "no_template_for_job") {
                toast.warning("Teste não foi enviado: nenhum modelo de teste vinculado a este cargo. Crie/vincule no Construtor de Testes.");
              } else if (releaseInfo.reason === "insert_failed") {
                toast.error("Falha ao criar o teste para o candidato. Verifique permissões e tente reenviar.");
              }
            }
          } catch (e) {
            console.error("[InterviewDecisionDialog] release test failed", e);
          }

          const baseBody = jobTitle
            ? `Sua entrevista para a vaga ${jobTitle} foi aprovada.`
            : "Sua entrevista foi aprovada.";
          const testHint = releaseInfo?.released
            ? releaseInfo.modality === "online"
              ? " Próxima etapa: realizar o teste online. Acesse pelo app."
              : releaseInfo.modality === "presencial"
                ? " Próxima etapa: agendar o teste presencial. Escolha um horário pelo app."
                : " Próxima etapa: realizar o teste (online ou presencial — você escolhe pelo app)."
            : releaseInfo && (releaseInfo as any).reason === "pipeline_phase_handles_test"
              ? " Próxima etapa: escolha a modalidade do teste (online ou presencial) pelo app."
              : " Aguarde os próximos passos.";

          sendNotification.mutate({
            eventType: "interview_approved",
            recipientId: iv.candidate_id,
            payload: {
              _title: "Entrevista aprovada! 🎉",
              _body: baseBody + testHint,
            },
          });
        }
      } else {
        sendNotification.mutate({
          eventType: "candidate_rejected",
          recipientId: iv.candidate_id,
          payload: {
            _title: "Atualização da candidatura",
            _body: trimmed
              ? `Mensagem do recrutador: ${trimmed}`
              : "Seu perfil foi direcionado ao banco de talentos. Você será notificado sobre novas oportunidades compatíveis.",
          },
        });
      }

      // 4. Invalidar queries
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["candidate_interviews"] });
      qc.invalidateQueries({ queryKey: ["candidate_interviews_batch"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["interview_feedback_decisions"] });
      qc.invalidateQueries({ queryKey: ["interview_approval_gate"] });
      qc.invalidateQueries({ queryKey: ["scheduling_interview_decisions"] });

      // Bate-papo aprovado já mostrou toast próprio (docs solicitados / duplicidade).
      if (!(isApprove && isBatePapo)) {
        toast.success(isApprove ? "Entrevista aprovada! Teste técnico liberado para o candidato." : "Candidato movido para standby.");
      }
      setReason("");
      onOpenChange(false);
      onDone?.(iv.id);
    } catch (e: any) {
      toast.error(e.message || "Erro ao processar decisão");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isApprove ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-primary" />
                {isBatePapo ? "Aprovar teste presencial" : "Aprovar entrevista"}
              </>
            ) : (
              <><XCircle className="h-5 w-5 text-yellow-600" /> Mover para standby</>
            )}
          </DialogTitle>
        </DialogHeader>

        {isApprove && (
          <Alert>
            <FlaskConical className="h-4 w-4 text-primary" />
            <AlertDescription className="text-xs">
              {isBatePapo ? (
                <>
                  Ao confirmar, o candidato será <strong>aprovado</strong> e enviado direto para a etapa de <strong>Documentação</strong>. A solicitação de documentos será criada automaticamente e o candidato receberá a notificação para envio.
                </>
              ) : (
                <>
                  Ao confirmar, o candidato será <strong>aprovado na entrevista</strong> e avançará automaticamente para o <strong>teste pós-entrevista</strong> (caso o cargo tenha teste configurado para esta fase).
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 py-2">
          <label className="text-xs font-medium text-foreground">
            {isStandby ? "Mensagem para o candidato (obrigatória)" : "Justificativa (opcional)"}
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isStandby
              ? "Mensagem que será exibida ao candidato (motivo do standby)..."
              : "Justificativa da aprovação..."}
            className="min-h-[90px] text-sm"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
