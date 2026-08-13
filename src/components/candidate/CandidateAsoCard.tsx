import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, MapPin, Calendar, Clock } from "lucide-react";
import {
  useApplicationAso,
  useApplicationAsoRealtime,
  type AsoRow,
} from "@/hooks/useApplicationAso";
import { formatDateBR } from "@/lib/dateUtils";

const STATUS: Record<AsoRow["status"], { label: string; cls: string }> = {
  pendente_agendamento: {
    label: "Aguardando agendamento",
    cls: "bg-gray-100 text-gray-700",
  },
  agendado: { label: "Agendado", cls: "bg-blue-100 text-blue-700" },
  laudo_enviado: {
    label: "Laudo em análise",
    cls: "bg-amber-100 text-amber-800",
  },
  aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-700" },
  reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-700" },
};

interface Props {
  applicationId: string;
  candidateId?: string;
}

export function CandidateAsoCard({ applicationId }: Props) {
  const { data: aso } = useApplicationAso(applicationId);
  useApplicationAsoRealtime(applicationId);

  // Só mostra após o franqueado agendar
  if (!aso || aso.status === "pendente_agendamento") return null;

  const s = STATUS[aso.status];

  return (
    <Card className="border-2 border-emerald-200 dark:border-emerald-800 shadow-sm overflow-hidden">
      <CardHeader className="pb-3 bg-emerald-50/40 dark:bg-emerald-950/20">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Stethoscope className="h-4 w-4" />
            </div>
            Exame admissional (ASO)
          </span>
          <Badge className={`${s.cls} border-0 text-[10px]`}>{s.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm pt-4">
        <div className="bg-emerald-50/40 dark:bg-emerald-950/20 rounded-lg p-3 space-y-2.5">
          {aso.address && (
            <div className="flex items-start gap-2.5">
              <MapPin className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-[11px] text-muted-foreground">Local</p>
                <p className="text-foreground font-medium leading-snug">{aso.address}</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            {aso.scheduled_date && (
              <div className="flex items-start gap-2.5">
                <Calendar className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-[11px] text-muted-foreground">Data</p>
                  <p className="text-foreground font-medium">{formatDateBR(aso.scheduled_date)}</p>
                </div>
              </div>
            )}
            {aso.scheduled_time && (
              <div className="flex items-start gap-2.5">
                <Clock className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-[11px] text-muted-foreground">Horário</p>
                  <p className="text-foreground font-medium">{aso.scheduled_time.slice(0, 5)}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {aso.status === "reprovado" && aso.rejection_reason && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-800 dark:text-red-200">
            <p className="font-medium mb-1">Ajuste necessário</p>
            <p>{aso.rejection_reason}</p>
          </div>
        )}

        {(aso.status === "agendado" || aso.status === "reprovado") && (
          <p className="text-xs text-muted-foreground">
            O laudo do ASO será anexado pela equipe de recrutamento após a realização do exame.
          </p>
        )}

        {aso.status === "laudo_enviado" && (
          <p className="text-xs text-muted-foreground">
            O laudo foi anexado e está em análise pela equipe.
          </p>
        )}

        {aso.status === "aprovado" && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            ASO aprovado. Você está liberado para contratação.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
