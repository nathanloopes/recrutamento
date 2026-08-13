import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  History,
  Link2,
  PlayCircle,
  CheckCircle2,
  SkipForward,
  RefreshCw,
  CalendarClock,
  FileText,
  Trophy,
  Flag,
  Activity,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApplicationJourney, type JourneyEvent } from "@/hooks/useApplicationJourney";

const EVENT_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  application_created: { label: "Candidatura criada", icon: PlayCircle, color: "text-emerald-600" },
  link_origin_recorded: { label: "Origem via link registrada", icon: Link2, color: "text-amber-600" },
  discovery_skipped: { label: "Discovery pulado", icon: SkipForward, color: "text-zinc-500" },
  phase_entered: { label: "Entrou na fase", icon: PlayCircle, color: "text-blue-600" },
  phase_completed: { label: "Fase concluída", icon: CheckCircle2, color: "text-emerald-600" },
  phase_skipped: { label: "Fase pulada", icon: SkipForward, color: "text-zinc-500" },
  status_changed: { label: "Status alterado", icon: Activity, color: "text-indigo-600" },
  cycle_restarted: { label: "Novo ciclo", icon: RefreshCw, color: "text-amber-600" },
  score_recorded: { label: "Score registrado", icon: Trophy, color: "text-yellow-600" },
  interview_scheduled: { label: "Entrevista agendada", icon: CalendarClock, color: "text-blue-600" },
  interview_status_changed: { label: "Entrevista atualizada", icon: CalendarClock, color: "text-blue-600" },
  interview_decision: { label: "Decisão de entrevista", icon: CheckCircle2, color: "text-emerald-600" },
  documents_requested: { label: "Documentos solicitados", icon: FileText, color: "text-amber-600" },
  documents_completed: { label: "Documentos concluídos", icon: CheckCircle2, color: "text-emerald-600" },
  terminal_reached: { label: "Estado final", icon: Flag, color: "text-zinc-700" },
};

const SKIP_REASON_LABEL: Record<string, string> = {
  entered_via_direct_link: "Entrou via link direto (sem chat de descoberta)",
  auto_approve_no_test: "Vaga sem teste — liberação automática",
  auto_approve_score_meets_min: "Score atingiu o mínimo — liberação automática",
  triage_skipped_after_unit_choice: "Triagem pulada após escolha da unidade",
  restart_skip_to_documentation: "Reinício direto para documentação",
};

const SOURCE_LABEL: Record<string, string> = {
  link: "Link direto",
  portal: "Portal",
  recruiter: "Recrutador",
  system: "Sistema",
  candidate: "Candidato",
  migration: "Migração",
};

interface Props {
  applicationId?: string | null;
}

export function ApplicationJourneyTimeline({ applicationId }: Props) {
  const { data: events, isLoading } = useApplicationJourney(applicationId);
  const [filter, setFilter] = useState<"all" | "skipped" | "phases" | "status" | "origin">("all");
  const [collapsed, setCollapsed] = useState(false);

  const origin = useMemo(() => events?.find((e) => e.event_type === "link_origin_recorded"), [events]);
  const created = useMemo(() => events?.find((e) => e.event_type === "application_created"), [events]);

  const filtered = useMemo(() => {
    if (!events) return [];
    switch (filter) {
      case "skipped":
        return events.filter((e) => e.skipped);
      case "phases":
        return events.filter((e) => e.event_type.startsWith("phase_") || e.event_type === "cycle_restarted");
      case "status":
        return events.filter((e) => e.event_type === "status_changed" || e.event_type === "terminal_reached");
      case "origin":
        return events.filter(
          (e) => e.event_type === "application_created" || e.event_type === "link_origin_recorded" || e.event_type === "discovery_skipped",
        );
      default:
        return events;
    }
  }, [events, filter]);

  if (!applicationId) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="h-4 w-4 text-primary" /> Histórico da candidatura
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && (
        <>
          {/* Cabeçalho de origem */}
          {(created || origin) && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">Origem:</span>
                <Badge variant="outline" className="text-[10px]">
                  {SOURCE_LABEL[created?.source || "portal"] || created?.source}
                </Badge>
                {origin?.origin_channel && (
                  <Badge variant="outline" className="text-[10px]">
                    canal: {origin.origin_channel}
                  </Badge>
                )}
                {origin?.origin_campaign && (
                  <Badge variant="outline" className="text-[10px]">
                    campanha: {origin.origin_campaign}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["all", "Tudo"],
                ["origin", "Origem"],
                ["phases", "Fases"],
                ["status", "Status"],
                ["skipped", "Puladas"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Timeline */}
          {isLoading ? (
            <p className="text-xs text-muted-foreground italic">Carregando histórico…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Sem eventos para este filtro.</p>
          ) : (
            <ol className="relative border-l border-border pl-4 space-y-3">
              {filtered.map((e) => (
                <TimelineItem key={e.id} event={e} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function TimelineItem({ event }: { event: JourneyEvent }) {
  const meta = EVENT_META[event.event_type] || {
    label: event.event_type,
    icon: Activity,
    color: "text-muted-foreground",
  };
  const Icon = meta.icon;

  return (
    <li className="relative">
      <span
        className={`absolute -left-[22px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-2 ring-border ${meta.color}`}
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{meta.label}</span>
          {event.skipped && (
            <Badge variant="secondary" className="text-[10px] bg-zinc-100 text-zinc-600 border-zinc-200">
              PULADA
            </Badge>
          )}
          {event.cycle_number && event.cycle_number > 1 && (
            <Badge variant="outline" className="text-[10px]">
              ciclo {event.cycle_number}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          {event.actor_role && ` · ${SOURCE_LABEL[event.actor_role] || event.actor_role}`}
        </p>
        {event.phase_label && (
          <p className="text-[11px] text-muted-foreground">
            Fase: <span className="text-foreground">{event.phase_label}</span>
            {event.phase_kind && <span className="opacity-70"> ({event.phase_kind})</span>}
          </p>
        )}
        {(event.from_status || event.to_status) && event.event_type === "status_changed" && (
          <p className="text-[11px] text-muted-foreground">
            <span className="opacity-70">{event.from_status || "—"}</span>
            {" → "}
            <span className="text-foreground">{event.to_status}</span>
          </p>
        )}
        {event.skip_reason && (
          <p className="text-[11px] text-zinc-500 italic">
            Motivo: {SKIP_REASON_LABEL[event.skip_reason] || event.skip_reason}
          </p>
        )}
        {event.score != null && (
          <p className="text-[11px] text-muted-foreground">
            Score: <span className="text-foreground font-medium">{Number(event.score).toFixed(1)}</span>
          </p>
        )}
        {event.details?.decision && (
          <p className="text-[11px] text-muted-foreground">
            Decisão: <span className="text-foreground">{event.details.decision}</span>
          </p>
        )}
      </div>
    </li>
  );
}
