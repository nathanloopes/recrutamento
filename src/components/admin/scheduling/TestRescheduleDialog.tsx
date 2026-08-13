import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { CalendarDays, Clock, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  useAvailableTestTimes,
  useTestSchedulingAvailability,
  useRescheduleTestBooking,
} from "@/hooks/useTestBookings";

interface TestRescheduleDialogProps {
  bookingId: string;
  applicationId: string;
  candidateId: string;
  unitId: string;
  oldDate: string;
  oldTime: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRescheduled?: () => void;
}

/**
 * Reagendamento de teste presencial (admin). Ação aplicada diretamente
 * (sem aprovação). Limite de 1 reagendamento por candidato é imposto na
 * mutation useRescheduleTestBooking. Modelado em RescheduleDialog.
 */
export function TestRescheduleDialog({
  bookingId,
  applicationId,
  candidateId,
  unitId,
  oldDate,
  oldTime,
  open,
  onOpenChange,
  onRescheduled,
}: TestRescheduleDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<{ slotId: string; startTime: string; endTime: string; modality: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showDoubleConfirm, setShowDoubleConfirm] = useState(false);
  const [reason, setReason] = useState("");

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;
  const { data: rawSlots, isLoading: timesLoading } = useAvailableTestTimes(unitId, dateStr);
  const { data: availability } = useTestSchedulingAvailability(unitId);
  const reschedule = useRescheduleTestBooking();

  const availableSlots = useMemo(() => {
    if (!rawSlots) return rawSlots;
    const seen = new Set<string>();
    return rawSlots
      .filter((s) => {
        if (seen.has(s.startTime)) return false;
        seen.add(s.startTime);
        return true;
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [rawSlots]);

  const disabledDays = (date: Date) => {
    if (date < new Date(new Date().setHours(0, 0, 0, 0))) return true;
    if (availability) {
      if (!availability.weekdays.has(date.getDay())) return true;
      if (availability.blockedDates.has(format(date, "yyyy-MM-dd"))) return true;
    }
    return false;
  };

  const handleConfirm = async () => {
    if (!selectedSlot || !selectedDate) return;
    try {
      await reschedule.mutateAsync({
        bookingId,
        applicationId,
        candidateId,
        oldDate,
        oldTime,
        newDate: format(selectedDate, "yyyy-MM-dd"),
        newTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        reason: reason || undefined,
      });
      toast.success("Teste reagendado com sucesso.");
      setConfirming(false);
      setSelectedSlot(null);
      setSelectedDate(undefined);
      setReason("");
      onOpenChange(false);
      onRescheduled?.();
    } catch (e) {
      safeToast.error(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Reagendar Teste
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          {confirming && selectedSlot && selectedDate ? (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedSlot.startTime.slice(0, 5)} - {selectedSlot.endTime.slice(0, 5)}</span>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
                ⚠️ Cada candidato pode reagendar o teste apenas uma vez. Após confirmar, esta ação não estará mais disponível.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo do reagendamento (opcional)</label>
                <Input
                  placeholder="Ex: conflito de horário, imprevisto..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
                  Voltar
                </Button>
                <Button className="flex-1" onClick={() => setShowDoubleConfirm(true)} disabled={reschedule.isPending}>
                  {reschedule.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                  Confirmar Reagendamento
                </Button>
              </div>
              <DoubleConfirmDialog
                open={showDoubleConfirm}
                onOpenChange={setShowDoubleConfirm}
                title="Confirmar reagendamento do teste?"
                description={`O teste será remarcado para ${format(selectedDate, "dd/MM/yyyy")} às ${selectedSlot.startTime.slice(0, 5)}. Só é permitido 1 reagendamento por candidato.`}
                confirmWord="CONFIRMAR"
                onConfirm={handleConfirm}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground mb-2">Selecione uma nova data:</p>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => { setSelectedDate(d); setSelectedSlot(null); }}
                disabled={disabledDays}
                className="rounded-md border mx-auto pointer-events-auto"
              />
              <div>
                <p className="text-sm font-medium mb-2">
                  {selectedDate ? `Horários disponíveis em ${format(selectedDate, "dd/MM")}:` : "Selecione uma data para ver os horários:"}
                </p>
                {selectedDate && timesLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : availableSlots && availableSlots.length === 0 && selectedDate ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum horário disponível nesta data.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 auto-rows-[2.5rem]">
                    {(availableSlots || []).map((slot) => (
                      <Button
                        key={slot.startTime}
                        variant={selectedSlot?.startTime === slot.startTime ? "default" : "outline"}
                        size="sm"
                        className="h-10 min-w-0 justify-center px-2 text-xs whitespace-nowrap"
                        disabled={!selectedDate}
                        onClick={() => setSelectedSlot(slot)}
                      >
                        {slot.startTime.slice(0, 5)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              {selectedSlot && (
                <Button className="w-full" onClick={() => setConfirming(true)}>Avançar para confirmação</Button>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
