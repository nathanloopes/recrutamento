import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  scheduled_time: string;
  status: string;
  modality: string;
  profiles?: { full_name?: string };
  units?: { name?: string };
  applications?: { unit_jobs?: { jobs?: { title?: string } } };
}

interface DayDetailPanelProps {
  date: Date;
  interviews: Interview[];
}

export function DayDetailPanel({ date, interviews }: DayDetailPanelProps) {
  const sorted = [...interviews].sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base capitalize">
          {format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{sorted.length} entrevista(s)</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma entrevista neste dia.</p>
        ) : (
          sorted.map((i) => {
            const st = statusMap[i.status] || statusMap.agendada;
            return (
              <div key={i.id} className="border rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    {i.scheduled_time?.slice(0, 5)}
                  </div>
                  <Badge variant={st.variant} className="text-[10px]">{st.label}</Badge>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {i.profiles?.full_name || "—"}
                </div>
                {i.applications?.unit_jobs?.jobs?.title && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Briefcase className="h-3 w-3" />
                    {i.applications.unit_jobs.jobs.title}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {i.modality === "online" ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                  {i.modality === "online" ? "Online" : "Presencial"}
                  {i.units?.name && ` · ${i.units.name}`}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
