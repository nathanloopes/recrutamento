import type { ElementType } from "react";
import { Stethoscope, MapPin, Calendar, Clock, Upload, FileCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import {
  useApplicationAso,
  useApplicationAsoRealtime,
  type AsoRow,
} from "@/hooks/useApplicationAso";
import { formatDateBR } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  AsoRow["status"],
  { label: string; cls: string; icon: React.ElementType }
> = {
  pendente_agendamento: {
    label: "Aguardando agendamento",
    cls: "bg-gray-100 text-gray-700",
    icon: Clock,
  },
  agendado: {
    label: "ASO agendado",
    cls: "bg-emerald-100 text-emerald-700",
    icon: Calendar,
  },
  laudo_enviado: {
    label: "Laudo em análise",
    cls: "bg-amber-100 text-amber-800",
    icon: FileCheck,
  },
  aprovado: {
    label: "ASO aprovado",
    cls: "bg-emerald-100 text-emerald-700",
    icon: FileCheck,
  },
  reprovado: {
    label: "Laudo recusado",
    cls: "bg-red-100 text-red-700",
    icon: AlertCircle,
  },
};

interface Props {
  applicationId: string;
}

export function AsoScheduleBanner({ applicationId }: Props) {
  const navigate = useNavigate();
  const { data: aso, isLoading } = useApplicationAso(applicationId);
  useApplicationAsoRealtime(applicationId);

  if (isLoading || !aso || aso.status === "pendente_agendamento") return null;

  const cfg = STATUS_CONFIG[aso.status];
  const canUpload = aso.status === "agendado" || aso.status === "reprovado";

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3",
        aso.status === "agendado" &&
          "bg-emerald-50/70 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800",
        aso.status === "laudo_enviado" &&
          "bg-amber-50/70 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800",
        aso.status === "reprovado" &&
          "bg-red-50/70 border-red-200 dark:bg-red-950/20 dark:border-red-800",
        aso.status === "aprovado" &&
          "bg-emerald-50/70 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Exame admissional (ASO)
            </p>
            <p className="text-xs text-muted-foreground">
              Compareça no local e horário indicados
            </p>
          </div>
        </div>
        <Badge className={`${cfg.cls} border-0 text-[10px] shrink-0`}>
          <cfg.icon className="h-3 w-3 mr-1" />
          {cfg.label}
        </Badge>
      </div>

      <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 space-y-2">
        {aso.address && (
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <span className="text-foreground font-medium leading-snug">
              {aso.address}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {aso.scheduled_date && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-medium">{formatDateBR(aso.scheduled_date)}</span>
            </div>
          )}
          {aso.scheduled_time && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-medium">{aso.scheduled_time.slice(0, 5)}</span>
            </div>
          )}
        </div>
      </div>

      {aso.status === "reprovado" && aso.rejection_reason && (
        <div className="rounded-md bg-red-100/50 border border-red-200 p-2.5 text-xs text-red-800 dark:text-red-200">
          <p className="font-medium mb-0.5">Motivo da recusa:</p>
          <p>{aso.rejection_reason}</p>
        </div>
      )}

      <Button
        size="sm"
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
        onClick={() => navigate(`/documentos/${applicationId}`)}
      >
        <Upload className="h-4 w-4 mr-2" />
        {canUpload
          ? aso.status === "reprovado"
            ? "Reenviar laudo do ASO"
            : "Enviar laudo do ASO"
          : "Acompanhar laudo do ASO"}
      </Button>
    </div>
  );
}
