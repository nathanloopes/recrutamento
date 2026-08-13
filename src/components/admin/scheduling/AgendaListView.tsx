import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, User, MapPin, Video, Briefcase } from "lucide-react";

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  agendada: { label: "Agendada", variant: "default" },
  confirmed: { label: "Agendada", variant: "default" },
  remarcada: { label: "Remarcada", variant: "secondary" },
  rescheduled: { label: "Remarcada", variant: "secondary" },
  cancelada: { label: "Cancelada", variant: "outline" },
  cancelled: { label: "Cancelada", variant: "outline" },
  concluida: { label: "Concluída", variant: "default" },
  completed: { label: "Concluída", variant: "default" },
  no_show: { label: "Não compareceu", variant: "destructive" },
  pending: { label: "Pendente", variant: "outline" },
};

interface Interview {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  modality: string;
  purpose?: string | null;
  profiles?: { full_name?: string };
  units?: { name?: string };
  applications?: { unit_jobs?: { jobs?: { title?: string } } };
}

interface AgendaListViewProps {
  interviews: Interview[];
}

export function AgendaListView({ interviews }: AgendaListViewProps) {
  // Group by date
  const grouped: Record<string, Interview[]> = {};
  const sorted = [...interviews].sort((a, b) => {
    const dc = a.scheduled_date.localeCompare(b.scheduled_date);
    if (dc !== 0) return dc;
    return a.scheduled_time.localeCompare(b.scheduled_time);
  });

  sorted.forEach((i) => {
    if (!grouped[i.scheduled_date]) grouped[i.scheduled_date] = [];
    grouped[i.scheduled_date].push(i);
  });

  const dates = Object.keys(grouped).sort();

  if (dates.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-12">Nenhuma entrevista encontrada no período.</p>;
  }

  return (
    <div className="space-y-6">
      {dates.map((dateStr) => {
        const d = new Date(dateStr + "T12:00:00");
        return (
          <div key={dateStr}>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider capitalize">
                {format(d, "EEEE, dd 'de' MMMM", { locale: ptBR })}
              </span>
              <Badge variant="outline" className="text-[10px]">{grouped[dateStr].length}</Badge>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-2">
              {grouped[dateStr].map((i) => {
                const st = statusMap[i.status] || statusMap.agendada;
                return (
                  <div key={i.id} className="flex items-center gap-4 border rounded-lg p-3">
                    <div className="text-center min-w-[50px]">
                      <p className="text-lg font-bold text-foreground">{i.scheduled_time?.slice(0, 5)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{i.profiles?.full_name || "—"}</span>
                        {i.purpose === "bate_papo" && (
                          <Badge variant="outline" className="text-[10px] border-emerald-600 text-emerald-700 shrink-0">
                            Bate-papo
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 text-xs text-muted-foreground">
                        {i.applications?.unit_jobs?.jobs?.title && (
                          <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{i.applications.unit_jobs.jobs.title}</span>
                        )}
                        <span className="flex items-center gap-1">
                          {i.modality === "online" ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                          {i.modality === "online" ? "Online" : "Presencial"}
                        </span>
                        {i.units?.name && <span>· {i.units.name}</span>}
                      </div>
                    </div>
                    <Badge variant={st.variant} className="text-[10px] shrink-0">{st.label}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
