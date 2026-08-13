import { useEffect, useMemo, useState } from "react";
import { Loader2, Clock, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
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
import { RescheduleDialog } from "@/components/candidate/RescheduleDialog";

interface InterviewWaitingScreenProps {
  interviewId: string;
  unitId: string;
  /** YYYY-MM-DD (BRT) */
  scheduledDate: string | null | undefined;
  /** HH:mm (BRT) */
  scheduledTime: string | null | undefined;
}

/**
 * Overlay de espera humanizado exibido sobre a sala LiveKit do candidato
 * enquanto o recrutador ainda não está presente.
 *
 * Regras (definidas pelo produto):
 *  - Antes do horário oficial: apenas mensagem "chegou cedo", sem cronômetro.
 *  - No horário oficial: inicia cronômetro 00:00 + "Aguardando recrutador".
 *  - 5min: mensagem de paciência.
 *  - 10min: mensagem + botão "Remarcar Entrevista".
 *  - Se o recrutador entrar na sala, esta tela desaparece imediatamente.
 */
export function InterviewWaitingScreen({
  interviewId,
  unitId,
  scheduledDate,
  scheduledTime,
}: InterviewWaitingScreenProps) {
  const scheduledAt = useMemo(() => {
    if (!scheduledDate) return null;
    // Horários são BRT (UTC-3). Veja memória interview-scheduled-time-brt.
    const time = scheduledTime || "00:00";
    const d = new Date(`${scheduledDate}T${time}:00-03:00`);
    return isNaN(d.getTime()) ? null : d;
  }, [scheduledDate, scheduledTime]);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);
  const [done, setDone] = useState(false);


  const dateLabel = scheduledAt
    ? scheduledAt.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const reachedScheduled = !!scheduledAt && now.getTime() >= scheduledAt.getTime();
  const waitSeconds = reachedScheduled && scheduledAt
    ? Math.max(0, Math.floor((now.getTime() - scheduledAt.getTime()) / 1000))
    : 0;
  const waitMinutes = Math.floor(waitSeconds / 60);
  const mm = String(Math.floor(waitSeconds / 60)).padStart(2, "0");
  const ss = String(waitSeconds % 60).padStart(2, "0");

  let phaseMessage: string;
  if (!reachedScheduled) {
    phaseMessage =
      "Você chegou cedo para sua entrevista. Tudo certo! Quando o horário agendado chegar, iniciaremos automaticamente o acompanhamento da entrada do recrutador.";
  } else if (waitMinutes < 5) {
    phaseMessage =
      "Seu recrutador foi avisado que você já está na sala e poderá entrar a qualquer momento.";
  } else if (waitMinutes < 10) {
    phaseMessage =
      "Seu recrutador pode estar finalizando outra entrevista ou enfrentando um pequeno imprevisto. Agradecemos sua paciência.";
  } else {
    phaseMessage =
      "Percebemos que seu recrutador ainda não entrou na sala. Sabemos que seu tempo é importante.";
  }

  const showReschedule = reachedScheduled && waitMinutes >= 10;

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-background to-muted/30 p-4 app-safe-area pwa-bottom-safe-area overflow-y-auto">
      <Card className="w-full max-w-md p-6 sm:p-8 text-center space-y-6 shadow-xl">
        {done ? (
          <>
            <CheckCircle2 className="h-14 w-14 mx-auto text-emerald-500" />
            <h2 className="text-xl font-semibold">Solicitação enviada</h2>
            <p className="text-sm text-muted-foreground">
              Sua solicitação foi registrada com sucesso. Em breve você receberá uma nova data para sua entrevista.
            </p>
            <Button onClick={() => window.location.assign("/inicio")} className="w-full">
              Voltar para início
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
              {reachedScheduled ? (
                <>
                  <div className="font-mono text-5xl sm:text-6xl font-bold tracking-tight tabular-nums">
                    {mm}:{ss}
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Aguardando recrutador
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Você chegou cedo</span>
                </div>
              )}
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed">{phaseMessage}</p>

            {dateLabel && (
              <p className="text-xs text-muted-foreground">
                Entrevista agendada para <strong>{dateLabel}</strong>.
              </p>
            )}

            {showReschedule && (
              <Button
                variant="default"
                className="w-full"
                onClick={() => setConfirmOpen(true)}
              >
                Remarcar Entrevista
              </Button>
            )}
          </>
        )}
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remarcar entrevista?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja solicitar o reagendamento desta entrevista? Nossa equipe notificará o recrutador e registrará sua solicitação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                setReschedOpen(true);
              }}
            >
              Confirmar Reagendamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RescheduleDialog
        interviewId={interviewId}
        unitId={unitId}
        open={reschedOpen}
        onOpenChange={setReschedOpen}
        onRescheduled={() => {
          setReschedOpen(false);
          setDone(true);
        }}
      />
    </div>
  );
}
