import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DayDetailPanel } from "./DayDetailPanel";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Interview {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  modality: string;
  candidate_id: string;
  unit_id: string;
  profiles?: { full_name?: string };
  units?: { name?: string };
  applications?: { unit_jobs?: { jobs?: { title?: string } } };
}

interface CalendarViewProps {
  interviews: Interview[];
  isLoading: boolean;
  maxPerDay: number;
  onMonthChange?: (date: Date) => void;
}

export function CalendarView({ interviews, isLoading, maxPerDay, onMonthChange }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Group interviews by date
  const interviewsByDate: Record<string, Interview[]> = {};
  interviews?.forEach((i) => {
    const d = i.scheduled_date;
    if (!interviewsByDate[d]) interviewsByDate[d] = [];
    interviewsByDate[d].push(i);
  });

  // Build modifiers for DayPicker
  const availableDays: Date[] = [];
  const partialDays: Date[] = [];
  const fullDays: Date[] = [];

  Object.entries(interviewsByDate).forEach(([dateStr, items]) => {
    const activeItems = items.filter((i) => i.status === "confirmed" || i.status === "rescheduled");
    const d = new Date(dateStr + "T12:00:00");
    if (activeItems.length === 0) return;
    if (activeItems.length >= maxPerDay) {
      fullDays.push(d);
    } else if (activeItems.length >= maxPerDay * 0.6) {
      partialDays.push(d);
    } else {
      availableDays.push(d);
    }
  });

  const dayInterviews = selectedDay
    ? interviewsByDate[format(selectedDay, "yyyy-MM-dd")] || []
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <Button variant="outline" size="icon" onClick={() => {
            const prev = subMonths(currentMonth, 1);
            setCurrentMonth(prev);
            onMonthChange?.(prev);
          }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold capitalize">
            {format(currentMonth, "MMMM yyyy", { locale: ptBR })}
          </h3>
          <Button variant="outline" size="icon" onClick={() => {
            const next = addMonths(currentMonth, 1);
            setCurrentMonth(next);
            onMonthChange?.(next);
          }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Calendar
          mode="single"
          selected={selectedDay ?? undefined}
          onSelect={(d) => setSelectedDay(d ?? null)}
          month={currentMonth}
          onMonthChange={(m) => { setCurrentMonth(m); onMonthChange?.(m); }}
          locale={ptBR}
          className="p-3 pointer-events-auto w-full"
          classNames={{
            months: "flex flex-col w-full",
            month: "space-y-4 w-full",
            table: "w-full border-collapse",
            head_row: "flex w-full",
            head_cell: "text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem] text-center",
            row: "flex w-full mt-2",
            cell: "flex-1 h-14 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
            day: "h-14 w-full p-0 font-normal aria-selected:opacity-100 hover:bg-accent rounded-md flex flex-col items-center justify-center gap-0.5",
            day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
            day_today: "bg-accent text-accent-foreground",
          }}
          components={{
            DayContent: ({ date }) => {
              const dateStr = format(date, "yyyy-MM-dd");
              const dayItems = interviewsByDate[dateStr];
              const activeCount = dayItems?.filter((i) => i.status === "confirmed" || i.status === "rescheduled").length || 0;
              const isFull = activeCount >= maxPerDay;
              const isPartial = activeCount >= maxPerDay * 0.6;

              return (
                <div className="flex flex-col items-center gap-0.5">
                  <span>{date.getDate()}</span>
                  {activeCount > 0 && (
                    <div className="flex items-center gap-0.5">
                      <div
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isFull ? "bg-destructive" : isPartial ? "bg-yellow-500" : "bg-green-500"
                        )}
                      />
                      <span className="text-[10px] text-muted-foreground">{activeCount}</span>
                    </div>
                  )}
                </div>
              );
            },
          }}
          modifiers={{
            available: availableDays,
            partial: partialDays,
            full: fullDays,
          }}
          modifiersStyles={{
            available: { borderLeft: "3px solid hsl(var(--chart-2))" },
            partial: { borderLeft: "3px solid hsl(45 93% 47%)" },
            full: { borderLeft: "3px solid hsl(var(--destructive))" },
          }}
        />

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-green-500" /> Disponível</div>
          <div className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-yellow-500" /> Parcial</div>
          <div className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-destructive" /> Lotado</div>
        </div>
      </div>

      {/* Side panel */}
      <div className="lg:col-span-1">
        {selectedDay ? (
          <DayDetailPanel date={selectedDay} interviews={dayInterviews} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12 border border-dashed rounded-lg">
            <CalendarDays className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">Selecione um dia no calendário</p>
            <p className="text-xs mt-1">para ver as entrevistas agendadas</p>
          </div>
        )}
      </div>
    </div>
  );
}
