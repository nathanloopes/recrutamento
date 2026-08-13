import { useState } from "react";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 19 }, (_, i) => `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`);

const statusColors: Record<string, string> = {
  agendada: "bg-primary/15 border-primary/30 text-primary",
  remarcada: "bg-yellow-500/15 border-yellow-500/30 text-yellow-700",
  cancelada: "bg-muted border-border text-muted-foreground line-through",
  concluida: "bg-green-500/15 border-green-500/30 text-green-700",
  no_show: "bg-destructive/15 border-destructive/30 text-destructive",
};

interface Interview {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  modality: string;
  profiles?: { full_name?: string };
  applications?: { unit_jobs?: { jobs?: { title?: string } } };
}

interface WeekDayViewProps {
  interviews: Interview[];
  mode: "week" | "day";
  currentDate: Date;
  onDateChange: (d: Date) => void;
}

export function WeekDayView({ interviews, mode, currentDate, onDateChange }: WeekDayViewProps) {
  const days = mode === "week"
    ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i))
    : [currentDate];

  const prev = () => onDateChange(addDays(currentDate, mode === "week" ? -7 : -1));
  const next = () => onDateChange(addDays(currentDate, mode === "week" ? 7 : 1));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="outline" size="icon" onClick={prev}><ChevronLeft className="h-4 w-4" /></Button>
        <h3 className="text-sm font-semibold">
          {mode === "week"
            ? `${format(days[0], "dd MMM", { locale: ptBR })} — ${format(days[6], "dd MMM yyyy", { locale: ptBR })}`
            : format(currentDate, "EEEE, dd 'de' MMMM yyyy", { locale: ptBR })}
        </h3>
        <Button variant="outline" size="icon" onClick={next}><ChevronRight className="h-4 w-4" /></Button>
      </div>

      <div className="overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: `60px repeat(${days.length}, minmax(120px, 1fr))` }}>
          {/* Header row */}
          <div className="border-b p-2 text-xs text-muted-foreground" />
          {days.map((d) => (
            <div key={d.toISOString()} className={cn("border-b p-2 text-center text-xs font-medium", isSameDay(d, new Date()) && "bg-accent")}>
              <div className="capitalize">{format(d, "EEE", { locale: ptBR })}</div>
              <div className="text-lg">{format(d, "dd")}</div>
            </div>
          ))}

          {/* Time rows */}
          {HOURS.map((hour) => (
            <>
              <div key={`label-${hour}`} className="border-b border-r px-2 py-1 text-[10px] text-muted-foreground flex items-start pt-1">
                {hour}
              </div>
              {days.map((d) => {
                const dateStr = format(d, "yyyy-MM-dd");
                const slotInterviews = interviews.filter(
                  (i) => i.scheduled_date === dateStr && i.scheduled_time?.slice(0, 5) === hour
                );
                return (
                  <div key={`${dateStr}-${hour}`} className="border-b border-r min-h-[36px] p-0.5 relative">
                    {slotInterviews.map((i) => {
                      const colors = statusColors[i.status] || statusColors.agendada;
                      return (
                        <div key={i.id} className={cn("rounded px-1.5 py-0.5 text-[10px] border mb-0.5 truncate", colors)}>
                          {i.profiles?.full_name?.split(" ")[0] || "—"}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}
