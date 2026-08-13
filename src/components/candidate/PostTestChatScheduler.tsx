import { useMemo, useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarDays, Clock, Video, Loader2, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useChatSlots, useChatAvailableTimes, useChatUnavailableDates, useScheduleChat } from "@/hooks/useChatScheduling";

interface Props {
  applicationId: string;
  unitId: string;
  candidateId?: string;
  jobTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
}

/**
 * Agendador exclusivo do Bate-Papo Pós-Teste. Usa `chat_availability_slots` e
 * as RPCs `get_chat_available_times` / `get_chat_unavailable_dates` — nunca
 * toca na tabela ou hooks da Entrevista.
 */
export function PostTestChatScheduler({ applicationId, unitId, candidateId, jobTitle, open, onOpenChange, onScheduled }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const recipientId = candidateId || user?.id;

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<{ slotId: string; startTime: string; endTime: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;

  const { data: rawSlots, isLoading: timesLoading } = useChatAvailableTimes(unitId, dateStr);
  const availableSlots = useMemo(() => {
    if (!rawSlots) return rawSlots;
    const seen = new Set<string>();
    return rawSlots
      .filter((s: any) => { if (seen.has(s.startTime)) return false; seen.add(s.startTime); return true; })
      .sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
  }, [rawSlots]);

  const { data: unitSlots } = useChatSlots(unitId);
  const activeDaysOfWeek = useMemo(() => new Set((unitSlots || []).map((s: any) => s.day_of_week as number)), [unitSlots]);
  const { data: unavailableDates } = useChatUnavailableDates(unitId, 90);

  const SCHEDULING_WINDOW_BUSINESS_DAYS = 7;
  const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

  const maxBusinessDate = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let counted = 0;
    const cursor = new Date(today);
    while (counted < SCHEDULING_WINDOW_BUSINESS_DAYS) {
      if (isWeekday(cursor)) counted++;
      if (counted < SCHEDULING_WINDOW_BUSINESS_DAYS) cursor.setDate(cursor.getDate() + 1);
    }
    return cursor;
  }, []);

  const nextAvailableDate = useMemo(() => {
    if (activeDaysOfWeek.size === 0) return undefined;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cursor = new Date(today);
    while (cursor <= maxBusinessDate) {
      if (isWeekday(cursor) && activeDaysOfWeek.has(cursor.getDay())) {
        const ymd = format(cursor, "yyyy-MM-dd");
        if (!unavailableDates?.has(ymd)) return new Date(cursor);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return undefined;
  }, [activeDaysOfWeek, unavailableDates, maxBusinessDate]);

  const { data: blockedDates } = useQuery({
    queryKey: ["blocked_dates_chat_candidate", unitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blocked_dates" as any)
        .select("date")
        .or(`unit_id.eq.${unitId},unit_id.is.null`)
        .gte("date", new Date().toISOString().split("T")[0]);
      if (error) throw error;
      return new Set((data || []).map((d: any) => d.date));
    },
  });

  const scheduleChat = useScheduleChat();

  const disabledDays = (date: Date) => {
    const s = format(date, "yyyy-MM-dd");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (date < today) return true;
    if (date > maxBusinessDate) return true;
    if (!isWeekday(date)) return true;
    if (blockedDates?.has(s)) return true;
    if (activeDaysOfWeek.size > 0 && !activeDaysOfWeek.has(date.getDay())) return true;
    if (unavailableDates?.has(s)) return true;
    return false;
  };

  // Realtime: invalida disponibilidade ao mudar interviews do tipo bate_papo.
  useEffect(() => {
    if (!open || !unitId) return;
    const channel = supabase
      .channel(`chat_scheduler_${unitId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interviews", filter: `unit_id=eq.${unitId}` }, () => {
        qc.invalidateQueries({ queryKey: ["chat_available_times"] });
        qc.invalidateQueries({ queryKey: ["chat_unavailable_dates"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, unitId, qc]);

  const handleConfirm = async () => {
    if (!selectedSlot || !selectedDate || !recipientId) return;
    try {
      await scheduleChat.mutateAsync({
        application_id: applicationId,
        candidate_id: recipientId,
        unit_id: unitId,
        slot_id: selectedSlot.slotId,
        scheduled_date: format(selectedDate, "yyyy-MM-dd"),
        scheduled_time: selectedSlot.startTime,
      });
      toast.success("Bate-papo agendado! Você receberá o link da sala assim que o horário se aproximar.", { duration: 5000 });
      setConfirming(false);
      setSelectedSlot(null);
      setSelectedDate(undefined);
      onOpenChange(false);
      onScheduled?.();
    } catch (e) { safeToast.error(e); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Agendar bate-papo{jobTitle ? ` — ${jobTitle}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto">
          {!unitId ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>Não foi possível identificar a unidade. Recarregue a página.</AlertDescription>
            </Alert>
          ) : unitSlots && unitSlots.length === 0 ? (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                A unidade ainda não cadastrou horários de bate-papo. Aguarde — assim que o recrutador disponibilizar horários, você será notificado(a).
              </AlertDescription>
            </Alert>
          ) : confirming && selectedSlot && selectedDate ? (
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
              <Alert>
                <Video className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  O bate-papo é 100% online. A sala será criada automaticamente e o link ficará disponível no seu painel próximo ao horário agendado.
                </AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Voltar</Button>
                <Button className="flex-1" onClick={handleConfirm} disabled={scheduleChat.isPending}>
                  {scheduleChat.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                  Confirmar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Selecione uma data disponível:</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Agendamentos liberados apenas para os próximos 7 dias úteis (seg–sex).
                </p>
                {nextAvailableDate && (
                  <p className="text-xs text-primary font-medium mb-2 text-center">
                    ✨ Próxima data disponível: {format(nextAvailableDate, "EEEE, dd/MM", { locale: ptBR })}
                  </p>
                )}
                {(() => {
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  return (
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => { setSelectedDate(d); setSelectedSlot(null); }}
                      disabled={disabledDays}
                      defaultMonth={nextAvailableDate}
                      fromDate={today}
                      toDate={maxBusinessDate}
                      className="rounded-md border mx-auto pointer-events-auto"
                      today={selectedDate ? undefined : new Date()}
                    />
                  );
                })()}
              </div>

              <div>
                <p className="text-sm font-medium mb-2">
                  {selectedDate ? `Horários disponíveis em ${format(selectedDate, "dd/MM")}:` : "Selecione uma data para ver os horários:"}
                </p>
                {selectedDate && timesLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : availableSlots && availableSlots.length === 0 && selectedDate ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Não há mais horários disponíveis nesta data. Escolha outra.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 auto-rows-[2.5rem]">
                    {(availableSlots || []).map((slot: any) => (
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
                <Button className="w-full" onClick={() => setConfirming(true)}>
                  Avançar para confirmação
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
