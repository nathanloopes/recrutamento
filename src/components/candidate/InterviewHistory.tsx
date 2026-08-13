import { useState } from "react";
import { Calendar, CheckCircle2, XCircle, RefreshCw, CalendarCheck, CalendarPlus, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Interview {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  status: string;
  modality: string | null;
  confirmed_at?: string | null;
  units?: { name: string } | null;
}

interface InterviewHistoryProps {
  interviews: Interview[];
  onReschedule?: (interview: Interview) => void;
  onConfirmAttendance?: (interviewId: string) => void;
  confirmingAttendance?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  completed: { label: "Concluída", icon: CheckCircle2, variant: "default" },
  confirmed: { label: "Confirmada", icon: Calendar, variant: "secondary" },
  rescheduled: { label: "Remarcada", icon: RefreshCw, variant: "outline" },
  reschedule_requested: { label: "Reagendamento", icon: RefreshCw, variant: "outline" },
  cancelled: { label: "Cancelada", icon: XCircle, variant: "destructive" },
  pending_approval: { label: "Pendente", icon: Calendar, variant: "secondary" },
  no_show: { label: "Não compareceu", icon: XCircle, variant: "destructive" },
};

const COLLAPSE_THRESHOLD = 2;

export function InterviewHistory({ interviews, onReschedule, onConfirmAttendance, confirmingAttendance }: InterviewHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  if (!interviews || interviews.length === 0) return null;

  // Sort ascending (oldest first)
  const sorted = [...interviews].sort(
    (a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
  );

  const canCollapse = sorted.length > COLLAPSE_THRESHOLD;
  const visible = canCollapse && !expanded ? sorted.slice(-COLLAPSE_THRESHOLD) : sorted;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Histórico de Entrevistas
        </p>
        {canCollapse && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-muted-foreground px-2"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>Ver menos <ChevronUp className="h-3 w-3 ml-1" /></>
            ) : (
              <>Ver mais ({sorted.length}) <ChevronDown className="h-3 w-3 ml-1" /></>
            )}
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((iv) => {
          const cfg = STATUS_CONFIG[iv.status] || { label: iv.status, icon: Calendar, variant: "secondary" as const };
          const Icon = cfg.icon;
          const isConfirmed = iv.status === "confirmed";
          return (
            <div key={iv.id} className="flex flex-col gap-2 p-2 rounded-lg bg-muted/40">
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {format(new Date(iv.scheduled_date + "T00:00:00"), "dd 'de' MMM", { locale: ptBR })}
                    {iv.scheduled_time ? ` às ${(iv.scheduled_time as string).slice(0, 5)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {iv.modality || "presencial"}
                    {(iv.units as any)?.name ? ` · ${(iv.units as any).name}` : ""}
                  </p>
                </div>
                <Badge variant={cfg.variant} className="text-[10px] shrink-0">
                  {cfg.label}
                </Badge>
              </div>
              {/* Action buttons for confirmed interviews */}
              {isConfirmed && (onReschedule || onConfirmAttendance) && (
                <div className="flex items-center gap-2 ml-7">
                  {onConfirmAttendance && !iv.confirmed_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      disabled={confirmingAttendance}
                      onClick={() => onConfirmAttendance(iv.id)}
                    >
                      <CalendarCheck className="h-3 w-3 mr-1" />
                      Confirmar Presença
                    </Button>
                  )}
                  {iv.confirmed_at && (
                    <Badge variant="secondary" className="text-[10px] bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 mr-1" />Presença confirmada
                    </Badge>
                  )}
                  {onReschedule && iv.confirmed_at && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7"
                      onClick={() => onReschedule(iv)}
                    >
                      <CalendarPlus className="h-3 w-3 mr-1" />
                      Reagendar
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
