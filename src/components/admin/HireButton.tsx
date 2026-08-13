import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserCheck } from "lucide-react";
import { useApplicationDocsPending } from "@/lib/documentsStatus";
import { useApplicationAso } from "@/hooks/useApplicationAso";
import { cn } from "@/lib/utils";

interface HireButtonProps {
  applicationId: string;
  candidateId?: string;
  onClick: () => void;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
  iconOnly?: boolean;
}

/**
 * "Contratar" button — fica desabilitado enquanto:
 *  - houver documentos obrigatórios não aprovados, OU
 *  - o ASO ainda não estiver aprovado.
 */
export function HireButton({
  applicationId,
  candidateId,
  onClick,
  className,
  size = "sm",
  iconOnly = false,
}: HireButtonProps) {
  const { data: docs } = useApplicationDocsPending(applicationId, candidateId);
  const { data: aso } = useApplicationAso(applicationId);

  const docsPending = !!docs?.hasPending;
  const asoBlocked = !aso || aso.status !== "aprovado";
  const blocked = docsPending || asoBlocked;

  const button = (
    <Button
      variant="default"
      size={size}
      onClick={onClick}
      disabled={blocked}
      className={cn("bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60", className)}
    >
      <UserCheck className={cn(iconOnly ? "h-3.5 w-3.5" : "h-3 w-3 mr-1")} />
      {!iconOnly && "Contratar"}
    </Button>
  );

  if (!blocked) return button;

  let reason: string;
  if (docsPending) {
    reason = (docs as any)?.requiresDocsRequest
      ? "Envie a solicitação de documentos antes de contratar."
      : `Aguarde a aprovação de todos os documentos para contratar${
          docs?.total ? ` (${docs.pending}/${docs.total} pendentes).` : "."
        }`;
  } else if (!aso) {
    reason = "Agende o exame admissional (ASO) após o candidato enviar os documentos.";
  } else if (aso.status === "pendente_agendamento") {
    reason = "Agende o ASO para liberar a contratação.";
  } else if (aso.status === "agendado") {
    reason = "Aguardando o candidato enviar o laudo do ASO.";
  } else if (aso.status === "laudo_enviado") {
    reason = "Aprove o laudo do ASO para liberar a contratação.";
  } else if (aso.status === "reprovado") {
    reason = "ASO reprovado — aguarde reenvio do laudo pelo candidato.";
  } else {
    reason = "Aguarde a aprovação do ASO para contratar.";
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
