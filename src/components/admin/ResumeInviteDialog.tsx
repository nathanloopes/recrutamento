import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Send, Clock, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RESTART_MODE_LABELS, type RestartMode } from "@/lib/applicationCycle";
import { useInviteStandbyToResume, useCancelStandbyInvite } from "@/hooks/useTalentPool";

export interface ResumeInviteCandidate {
  candidate_id: string;
  profiles?: { full_name?: string | null } | null;
}

interface ResumeInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitJobId: string | null | undefined;
  candidate: ResumeInviteCandidate | null | undefined;
  jobTitle?: string | null;
  latestInvite?: any;
}

export function ResumeInviteDialog({
  open,
  onOpenChange,
  unitJobId,
  candidate,
  jobTitle,
  latestInvite,
}: ResumeInviteDialogProps) {
  const [resumeMode, setResumeMode] = useState<RestartMode>("triagem");
  const inviteResume = useInviteStandbyToResume();
  const cancelResumeInvite = useCancelStandbyInvite();

  const blocked = latestInvite?.status === "pending" || latestInvite?.status === "accepted";
  const label = latestInvite?.status === "declined" ? "Convidar novamente" : "Enviar convite";
  const when = latestInvite?.invited_at
    ? format(new Date(latestInvite.invited_at), "dd/MM 'às' HH:mm", { locale: ptBR })
    : "";
  const respondedWhen = latestInvite?.responded_at
    ? format(new Date(latestInvite.responded_at), "dd/MM 'às' HH:mm", { locale: ptBR })
    : "";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-emerald-600" />
            Convidar a retomar a candidatura?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Será enviada uma notificação para{" "}
            <strong className="name-display">{candidate?.profiles?.full_name || "o candidato"}</strong>{" "}
            perguntando se deseja retomar a candidatura para{" "}
            <strong>{jobTitle || "—"}</strong>. A candidatura só será reativada se o candidato aceitar.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {latestInvite?.status === "pending" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm flex items-start gap-2">
            <Clock className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-amber-900">Convite já enviado em {when}</p>
              <p className="text-amber-800 text-xs mt-0.5">
                Aguardando resposta do candidato. Cancele o convite atual antes de enviar um novo.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
                disabled={cancelResumeInvite.isPending}
                onClick={() =>
                  cancelResumeInvite.mutate(latestInvite.id, { onSuccess: () => onOpenChange(false) })
                }
              >
                {cancelResumeInvite.isPending ? "Cancelando..." : "Cancelar convite atual"}
              </Button>
            </div>
          </div>
        )}

        {latestInvite?.status === "accepted" && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-700 shrink-0" />
            <div>
              <p className="font-medium text-emerald-900">Candidato aceitou em {respondedWhen || when}</p>
              <p className="text-emerald-800 text-xs mt-0.5">
                A candidatura já foi reativada
                {latestInvite.restart_mode
                  ? ` (modo: ${RESTART_MODE_LABELS[latestInvite.restart_mode as RestartMode] || latestInvite.restart_mode})`
                  : ""}
                .
              </p>
            </div>
          </div>
        )}

        {latestInvite?.status === "declined" && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm flex items-start gap-2">
            <XCircle className="h-4 w-4 mt-0.5 text-rose-700 shrink-0" />
            <div>
              <p className="font-medium text-rose-900">Candidato recusou em {respondedWhen || when}</p>
              <p className="text-rose-800 text-xs mt-0.5">
                Você pode enviar um novo convite se quiser tentar novamente.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2 py-2">
          <p className="text-sm font-medium">Ao aceitar, recomeçar em:</p>
          <RadioGroup
            value={resumeMode}
            onValueChange={(v) => setResumeMode(v as RestartMode)}
            className="space-y-1.5"
          >
            {(["triagem", "teste", "entrevista", "documentacao", "last_valid"] as RestartMode[]).map((m) => (
              <div key={m} className="flex items-center space-x-2">
                <RadioGroupItem value={m} id={`resume-mode-${m}`} />
                <Label htmlFor={`resume-mode-${m}`} className="font-normal cursor-pointer text-sm">
                  {RESTART_MODE_LABELS[m]}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground pt-1">
            Etapas futuras serão zeradas. O histórico do ciclo anterior fica preservado.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Fechar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={inviteResume.isPending || blocked}
            onClick={(e) => {
              if (blocked) {
                e.preventDefault();
                return;
              }
              if (!candidate || !unitJobId) return;
              inviteResume.mutate(
                {
                  candidateId: candidate.candidate_id,
                  unitJobId,
                  candidateName: candidate.profiles?.full_name,
                  restartMode: resumeMode,
                },
                {
                  onSettled: () => {
                    onOpenChange(false);
                    setResumeMode("triagem");
                  },
                }
              );
            }}
          >
            {inviteResume.isPending ? "Enviando..." : label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
