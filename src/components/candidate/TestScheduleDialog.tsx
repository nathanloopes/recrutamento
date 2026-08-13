import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { FlaskConical, Clock, CalendarDays, Loader2, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useAvailableTestTimes, useCreateTestBooking, useTestSchedulingAvailability } from "@/hooks/useTestBookings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nulo no fluxo de pipeline (teste pós-entrevista) */
  testAssignmentId: string | null;
  applicationId: string;
  unitId: string;
  onBooked?: () => void;
}

export function TestScheduleDialog({
  open,
  onOpenChange,
  testAssignmentId,
  applicationId,
  unitId,
  onBooked,
}: Props) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const ymd = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;
  const { data: slots, isLoading } = useAvailableTestTimes(unitId, ymd);
  const { data: availability } = useTestSchedulingAvailability(unitId);
  const createBooking = useCreateTestBooking();

  const disabledDays = (d: Date) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (d < today) return true;
    // Sem config carregada ainda → não trava; quando chegar, filtra.
    if (!availability) return false;
    if (availability.weekdays.size === 0) return true; // unidade sem dias de teste configurados
    if (!availability.weekdays.has(d.getDay())) return true;
    const ymd = format(d, "yyyy-MM-dd");
    if (availability.blockedDates.has(ymd)) return true;
    return false;
  };

  const handleConfirm = async () => {
    if (!selectedSlot || !ymd) return;
    try {
      await createBooking.mutateAsync({
        testAssignmentId,
        applicationId,
        unitId,
        scheduledDate: ymd,
        scheduledTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
      });
      toast.success("Teste presencial agendado! Você receberá um lembrete antes da data.");
      onOpenChange(false);
      setSelectedDate(undefined);
      setSelectedSlot(null);
      onBooked?.();
    } catch (e: any) {
      toast.error(e.message || "Falha ao agendar o teste.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Agendar teste presencial
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Escolha uma data e horário disponíveis na unidade para realizar o teste.
            </p>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => { setSelectedDate(d); setSelectedSlot(null); }}
              disabled={disabledDays}
              className="rounded-md border mx-auto pointer-events-auto"
            />
            <div>
              <p className="text-sm font-medium mb-2">
                {selectedDate ? `Horários em ${format(selectedDate, "dd/MM")}:` : "Selecione uma data:"}
              </p>
              {selectedDate && isLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : slots && slots.length === 0 && selectedDate ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum horário disponível nesta data.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(slots || []).map((s) => (
                    <Button
                      key={s.slotId || s.startTime}
                      size="sm"
                      variant={selectedSlot?.startTime === s.startTime ? "default" : "outline"}
                      className="h-10 text-xs"
                      onClick={() => setSelectedSlot(s)}
                    >
                      {s.startTime.slice(0, 5)}
                      {s.endTime ? ` – ${s.endTime.slice(0, 5)}` : ""}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {selectedSlot && selectedDate && (
              <Card className="border-primary/40">
                <CardContent className="p-3 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    {selectedSlot.startTime.slice(0, 5)}
                    {selectedSlot.endTime ? ` - ${selectedSlot.endTime.slice(0, 5)}` : ""}
                  </div>
                </CardContent>
              </Card>
            )}

            <Button
              className="w-full"
              disabled={!selectedSlot || createBooking.isPending}
              onClick={handleConfirm}
            >
              {createBooking.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Confirmar agendamento
            </Button>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
