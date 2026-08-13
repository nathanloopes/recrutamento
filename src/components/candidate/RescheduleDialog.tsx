import { useState, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAvailableTimes, useRescheduleInterview } from "@/hooks/useScheduling";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { Input } from "@/components/ui/input";
import { CalendarDays, Clock, MapPin, Video, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface RescheduleDialogProps {
  interviewId: string;
  unitId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRescheduled?: () => void;
  purpose?: "entrevista" | "bate_papo";
}

export function RescheduleDialog({ interviewId, unitId, open, onOpenChange, onRescheduled, purpose = "entrevista" }: RescheduleDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<{ slotId: string; startTime: string; endTime: string; modality: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showDoubleConfirm, setShowDoubleConfirm] = useState(false);
  const [modality, setModality] = useState<"presencial" | "online">("presencial");
  const [reason, setReason] = useState("");

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;
  const { data: rawAvailableSlots, isLoading: timesLoading } = useAvailableTimes(unitId, dateStr, { purpose, excludeInterviewId: interviewId });

  // Defesa extra na renderização: deduplica por horário de início e ordena
  const availableSlots = useMemo(() => {
    if (!rawAvailableSlots) return rawAvailableSlots;
    const seen = new Set<string>();
    return rawAvailableSlots
      .filter((s: any) => {
        if (seen.has(s.startTime)) return false;
        seen.add(s.startTime);
        return true;
      })
      .sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
  }, [rawAvailableSlots]);
  const reschedule = useRescheduleInterview();
  const { data: calendarSettings } = useGlobalSettings("calendar");
  const allowOnline = calendarSettings?.find(s => s.key === "allow_online_interviews")?.value !== false;
  const getDefaultModalityForSlot = (slot?: { modality?: string } | null): "presencial" | "online" => {
    return slot?.modality === "online" ? "online" : "presencial";
  };

  const disabledDays = (date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0));

  const handleConfirm = async () => {
    if (!selectedSlot || !selectedDate) return;
    try {
      // Slots de modalidade única: ignora o estado e usa o que a unidade configurou.
      const effectiveModality =
        selectedSlot.modality === "presencial" || selectedSlot.modality === "online"
          ? selectedSlot.modality
          : modality;
      await reschedule.mutateAsync({
        interviewId,
        newDate: format(selectedDate, "yyyy-MM-dd"),
        newTime: selectedSlot.startTime,
        newModality: effectiveModality,
        reason: reason || undefined,
      });
      toast.success("Solicitação de reagendamento enviada! Aguarde a aprovação do recrutador.");
      setConfirming(false);
      setSelectedSlot(null);
      setSelectedDate(undefined);
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
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Reagendar Entrevista</DialogTitle>
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
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <label className="text-sm font-medium">Modalidade</label>
                <div className="flex flex-wrap gap-2">
                  {(selectedSlot?.modality === "presencial" || selectedSlot?.modality === "ambos") && (
                    <Button type="button" size="sm" variant={modality === "presencial" ? "default" : "outline"} className="justify-center" onClick={() => setModality("presencial")}>
                      <MapPin className="h-4 w-4 mr-2" />Presencial
                    </Button>
                  )}
                  {allowOnline && (selectedSlot?.modality === "online" || selectedSlot?.modality === "ambos") && (
                    <Button type="button" size="sm" variant={modality === "online" ? "default" : "outline"} className="justify-center" onClick={() => setModality("online")}>
                      <Video className="h-4 w-4 mr-2" />Online
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
                ⏳ Sua solicitação de reagendamento será enviada ao recrutador. Você só receberá a confirmação após ele aprovar o novo horário{modality === "online" ? " e enviar o link da reunião" : ""}.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo do reagendamento (opcional)</label>
                <Input placeholder="Ex: conflito de horário, imprevisto pessoal..." value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Voltar</Button>
                <Button className="flex-1" onClick={() => setShowDoubleConfirm(true)} disabled={reschedule.isPending}>
                  {reschedule.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                  Confirmar Reagendamento
                </Button>
              </div>
              <DoubleConfirmDialog
                open={showDoubleConfirm}
                onOpenChange={setShowDoubleConfirm}
                title="Confirmar reagendamento?"
                description={`Você está reagendando sua entrevista para ${format(selectedDate, "dd/MM/yyyy")} às ${selectedSlot.startTime.slice(0, 5)}. Esta ação será registrada no sistema.`}
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
                    {(availableSlots || []).map((slot: any) => {
                      const label = slot.startTime.slice(0, 5);
                      return (
                        <Button
                          key={slot.startTime}
                          variant={selectedSlot?.startTime === slot.startTime ? "default" : "outline"}
                          size="sm"
                          className="h-10 min-w-0 justify-center px-2 text-xs whitespace-nowrap"
                          disabled={!selectedDate}
                          onClick={() => {
                            setSelectedSlot(slot);
                            setModality(getDefaultModalityForSlot(slot));
                          }}
                        >
                          {label}
                        </Button>
                      );
                    })}
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
