import { useState, useMemo, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAvailableTimes, useScheduleInterview, useNoShowBlock, useApprovalSettings, useAvailabilitySlots, useUnavailableDates } from "@/hooks/useScheduling";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { useChatboxEnabled } from "@/hooks/useChatboxEnabled";
import { useSendNotification } from "@/hooks/useNotifications";
import { useAuth } from "@/contexts/AuthContext";

import { CalendarDays, Clock, MapPin, Video, Loader2, CheckCircle2, ShieldAlert, Lock, Bot } from "lucide-react";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AIInterviewScreen } from "@/components/candidate/interview/AIInterviewScreen";
import type { InterviewConfig, InterviewResult } from "@/core/interviewEngine";
import { supabase } from "@/integrations/supabase/client";
import { releasePostInterviewTest } from "@/lib/releasePostInterviewTest";
import { useQueryClient, useQuery } from "@tanstack/react-query";

interface InterviewSchedulerProps {
  applicationId: string;
  unitId: string;
  candidateId?: string;
  jobTitle?: string;
  jobDescription?: string;
  jobId?: string;
  onScheduled?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 'entrevista' (default): fluxo padrão de agendamento de entrevista.
   * 'bate_papo': nova etapa "Informações do processo" pós-aprovação no teste
   * online. Reutiliza toda a agenda/disponibilidade existente; apenas troca os
   * textos do diálogo, força modalidade online e marca o compromisso como
   * bate-papo no banco para diferenciar do recrutador.
   */
  purpose?: "entrevista" | "bate_papo";
}

export function InterviewScheduler({ applicationId, unitId, candidateId, jobTitle, jobDescription, jobId, onScheduled, open, onOpenChange, purpose = "entrevista" }: InterviewSchedulerProps) {
  const isBatePapo = purpose === "bate_papo";
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const recipientId = candidateId || user?.id;
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<{ slotId: string; startTime: string; endTime: string; modality: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [modality, setModality] = useState<"presencial" | "online">("presencial");
  const [showAIInterview, setShowAIInterview] = useState(false);

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;

  // Use the scheduling engine instead of raw booked times
  const { data: rawAvailableSlots, isLoading: timesLoading } = useAvailableTimes(unitId, dateStr, { purpose });

  // Defesa extra na renderização: deduplica por horário de início e ordena,
  // mesmo que dados antigos/em cache cheguem duplicados.
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

  // Load all active slots to know which days-of-week have availability
  const { data: unitSlots } = useAvailabilitySlots(unitId);
  const activeDaysOfWeek = useMemo(() => {
    if (!unitSlots) return new Set<number>();
    return new Set(unitSlots.map((s: any) => s.day_of_week as number));
  }, [unitSlots]);

  // Whole-day unavailable set (today with all past slots, future fully booked, etc.)
  const { data: unavailableDates } = useUnavailableDates(unitId, 90, { purpose });

  // Limite de agendamento: candidato só pode agendar nos próximos 7 dias
  // ÚTEIS (seg–sex) e conforme a agenda configurada da unidade.
  const SCHEDULING_WINDOW_BUSINESS_DAYS = 7;
  const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

  // Última data útil dentro da janela (7 dias úteis a partir de hoje, contando hoje se for útil)
  const maxBusinessDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let counted = 0;
    const cursor = new Date(today);
    // Avança até completar 7 dias úteis válidos.
    while (counted < SCHEDULING_WINDOW_BUSINESS_DAYS) {
      if (isWeekday(cursor)) counted++;
      if (counted < SCHEDULING_WINDOW_BUSINESS_DAYS) {
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return cursor;
  }, []);

  // Próxima data disponível dentro da janela de dias úteis
  const nextAvailableDate = useMemo(() => {
    if (activeDaysOfWeek.size === 0) return undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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

  // Load blocked dates for this unit (global + unit-specific)
  const { data: blockedDates } = useQuery({
    queryKey: ["blocked_dates_candidate", unitId],
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
  const scheduleInterview = useScheduleInterview();
  const sendNotification = useSendNotification();
  const { data: noShowStatus, isLoading: noShowLoading } = useNoShowBlock(user?.id, applicationId);
  const { data: approvalSettings } = useApprovalSettings();
  const { data: calendarSettings } = useGlobalSettings("calendar");
  const allowOnline = calendarSettings?.find(s => s.key === "allow_online_interviews")?.value !== false;
  const { enabled: aiInterviewEnabled } = useChatboxEnabled();

  // Fail-safe: se a flag global desligar, nunca abrir a tela de Entrevista IA
  useEffect(() => {
    if (!aiInterviewEnabled && showAIInterview) setShowAIInterview(false);
  }, [aiInterviewEnabled, showAIInterview]);
  const getDefaultModalityForSlot = (slot?: { modality?: string } | null): "presencial" | "online" => {
    return slot?.modality === "online" ? "online" : "presencial";
  };

  // Load interview guide (roteiro) for the job
  const { data: interviewGuide } = useQuery({
    queryKey: ["interview_guide_for_job", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interview_guides" as any)
        .select("*")
        .eq("job_id", jobId!)
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Load escalation governance settings
  const { data: govSettings } = useQuery({
    queryKey: ["gov_escalation_settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_settings")
        .select("key, value")
        .in("key", ["escalation_score_margin", "escalation_on_inconsistency"]);
      const map: Record<string, any> = {};
      (data || []).forEach((s: any) => { map[s.key] = s.value; });
      return map;
    },
  });

  const disabledDays = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return true;
    // Limite de 7 dias úteis a partir de hoje
    if (date > maxBusinessDate) return true;
    // Apenas dias úteis (seg–sex)
    if (!isWeekday(date)) return true;
    if (blockedDates?.has(dateStr)) return true;
    // Conforme agenda configurada da unidade
    if (activeDaysOfWeek.size > 0 && !activeDaysOfWeek.has(date.getDay())) return true;
    // Dias sem horários remanescentes
    if (unavailableDates?.has(dateStr)) return true;
    return false;
  };

  // Realtime: refresh availability when interviews change for this unit while modal is open
  useEffect(() => {
    if (!open || !unitId) return;
    const channel = supabase
      .channel(`scheduler_interviews_${unitId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interviews", filter: `unit_id=eq.${unitId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["unavailable_dates"] });
          queryClient.invalidateQueries({ queryKey: ["available_times"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, unitId, queryClient]);

  const handleConfirm = async () => {
    if (!selectedSlot || !selectedDate || !user) return;
    try {
      // Modalidade efetiva: para slots de modalidade única (presencial OU
      // online) a escolha do candidato é IRRELEVANTE — vale o que a unidade
      // configurou. Só quando o slot é "ambos" usamos a seleção do candidato.
      const effectiveModality =
        selectedSlot.modality === "presencial" || selectedSlot.modality === "online"
          ? selectedSlot.modality
          : modality;
      const result = await scheduleInterview.mutateAsync({
        application_id: applicationId,
        candidate_id: recipientId!,
        unit_id: unitId,
        slot_id: selectedSlot.slotId,
        scheduled_date: format(selectedDate, "yyyy-MM-dd"),
        scheduled_time: selectedSlot.startTime,
        modality: effectiveModality,
        purpose,
        _isCandidateSelfSchedule: true,
      });

      // O status retornado depende da configuração do slot:
      //  - `confirmed` quando `availability_slots.auto_confirm = true` (auto-aprovação)
      //  - `pending_approval` caso contrário (recrutador precisa aprovar manualmente)
      const wasAutoConfirmed = (result as any)?.status === "confirmed";
      if (wasAutoConfirmed) {
        toast.success(isBatePapo ? "Bate-papo agendado com sucesso!" : "Entrevista agendada com sucesso!", { duration: 5000 });
      } else {
        toast.success("Solicitação enviada! Aguarde a aprovação do recrutador.", { duration: 5000 });
      }

      setConfirming(false);
      setSelectedSlot(null);
      setSelectedDate(undefined);
      setModality("presencial");
      onOpenChange(false);
      onScheduled?.();
    } catch (e) {
      safeToast.error(e);
    }
  };

  const isBlocked = noShowStatus?.blocked === true;

  const handleAIInterviewComplete = async (result: InterviewResult) => {
    try {
      const aiResultData = {
        finalScore: result.finalScore,
        decision: result.decision,
        dimensionAverages: result.dimensionAverages || {},
        turnCount: result.turnCount || 0,
        summary: result.summary || null,
        strengths: result.strengths || [],
        weaknesses: result.weaknesses || [],
      };

      // Find existing interview for this application and update it (don't insert a duplicate)
      const { data: existingInterview } = await supabase
        .from("interviews")
        .select("id, status")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let interviewId: string | null = null;
      if (existingInterview) {
        // PROTECTION: Only update evaluation fields — never promote from pending_approval
        await supabase
          .from("interviews")
          .update({
            modality: "ai_interview",
            ai_result: aiResultData,
            notes: `Entrevista IA concluída. Decisão: ${result.decision}. Score: ${result.finalScore}/100`,
            ...(existingInterview.status !== "pending_approval" ? { status: "completed" } : {}),
          } as any)
          .eq("id", existingInterview.id);
        interviewId = existingInterview.id;
      } else {
        // Edge case: no existing interview — insert one
        const { data: inserted } = await supabase.from("interviews").insert({
          application_id: applicationId,
          candidate_id: recipientId,
          unit_id: unitId,
          scheduled_date: format(new Date(), "yyyy-MM-dd"),
          scheduled_time: format(new Date(), "HH:mm:ss"),
          modality: "ai_interview",
          status: "completed",
          notes: `Entrevista IA concluída. Decisão: ${result.decision}. Score: ${result.finalScore}/100`,
          ai_result: aiResultData,
        } as any).select("id").maybeSingle();
        interviewId = (inserted as any)?.id || null;
      }

      // ─── Apply IA decision to interview_feedback + applications.status ───
      // Mapeamento decisão IA → decisão canônica (interview_feedback) + status app
      type Mapping = { feedbackDecision: "presencial" | "encerrado" | "standby"; nextAppStatus: "aprovado" | "standby" | null };
      const map: Record<string, Mapping> = {
        APPROVED: { feedbackDecision: "presencial", nextAppStatus: "aprovado" },
        TALENT_POOL: { feedbackDecision: "encerrado", nextAppStatus: "standby" },
        REJECTED: { feedbackDecision: "encerrado", nextAppStatus: "standby" },
        ESCALATED: { feedbackDecision: "standby", nextAppStatus: null },
      };
      const decisionMapping = map[result.decision] || map.REJECTED;

      // Read current app status to enforce valid transitions (never demote 'contratado')
      const { data: currentApp } = await supabase
        .from("applications")
        .select("status")
        .eq("id", applicationId)
        .maybeSingle();
      const previousStatus = (currentApp as any)?.status as string | undefined;

      // 1) Persist interview_feedback (idempotent per interview_id)
      if (interviewId) {
        const feedbackPayload = {
          interview_id: interviewId,
          evaluator_id: null,
          decision: decisionMapping.feedbackDecision,
          notes: `Avaliação automática (IA). Score: ${result.finalScore}/100. ${result.summary || ""}`.trim(),
          checklist_json: { ai_result: aiResultData, source: "ai_interview" },
        };
        const { data: existingFb } = await supabase
          .from("interview_feedback")
          .select("id")
          .eq("interview_id", interviewId)
          .maybeSingle();
        if (existingFb) {
          await supabase
            .from("interview_feedback")
            .update(feedbackPayload as any)
            .eq("id", (existingFb as any).id);
        } else {
          await supabase.from("interview_feedback").insert(feedbackPayload as any);
        }
      }

      // 2) Update applications.status with valid-transition guards
      let newStatus: string | null = null;
      if (decisionMapping.nextAppStatus === "aprovado") {
        if (previousStatus && ["pendente", "em_andamento", "em_avaliacao", "apto_para_vaga"].includes(previousStatus)) {
          newStatus = "aprovado";
        }
      } else if (decisionMapping.nextAppStatus === "standby") {
        if (previousStatus && previousStatus !== "contratado") {
          newStatus = "standby";
        }
      }
      if (newStatus) {
        await supabase
          .from("applications")
          .update({ status: newStatus } as any)
          .eq("id", applicationId);

        // Aprovação na entrevista IA → libera teste pós-entrevista (mesmo fluxo dos demais botões de aprovação)
        if (newStatus === "aprovado") {
          try {
            await releasePostInterviewTest(applicationId);
          } catch (e) {
            console.error("[InterviewScheduler] release post-interview test failed", e);
          }
        }
      }

      // 3) Banco de talentos quando rejeitado/talent_pool
      if (
        recipientId &&
        (result.decision === "TALENT_POOL" || result.decision === "REJECTED")
      ) {
        try {
          const { moveToStandby } = await import("@/lib/moveToStandby");
          await moveToStandby(
            recipientId,
            `Entrevista IA encerrada — ${jobTitle || "vaga"} (score ${result.finalScore}/100)`,
            jobId || undefined,
          );
        } catch (e) {
          console.warn("moveToStandby failed (non-fatal):", e);
        }
      }

      // 4) Auditoria
      try {
        await supabase.from("activity_logs").insert({
          user_id: recipientId,
          action: "ai_interview_decision_applied",
          module: "recrutamento",
          details: {
            application_id: applicationId,
            interview_id: interviewId,
            decision: result.decision,
            mapped_feedback_decision: decisionMapping.feedbackDecision,
            final_score: result.finalScore,
            previous_status: previousStatus,
            new_status: newStatus,
          },
        } as any);
      } catch (e) {
        console.warn("activity_logs insert failed (non-fatal):", e);
      }

      // Insert score event for AI interview
      await supabase.rpc("insert_score_event", {
        p_candidate_id: recipientId!,
        p_event_type: "interview_completed",
        p_process_stage: "entrevista",
        p_related_job_id: jobId || null,
        p_score_delta: result.finalScore,
        p_reason: `Entrevista IA concluída — ${jobTitle || "Cargo"}`,
        p_metadata: {
          source: "ai_interview",
          decision: result.decision,
          application_id: applicationId,
        },
      } as any);

      queryClient.invalidateQueries({ queryKey: ["my_interviews"] });
      queryClient.invalidateQueries({ queryKey: ["application_status"] });
      queryClient.invalidateQueries({ queryKey: ["score_events"] });
      queryClient.invalidateQueries({ queryKey: ["talent_pool"] });
      try {
        const { invalidateProcessCache } = await import("@/lib/processCacheSync");
        invalidateProcessCache(queryClient);
      } catch {}

      toast.success(
        result.decision === "APPROVED"
          ? "Entrevista IA concluída! Você foi aprovado(a)."
          : result.decision === "TALENT_POOL"
          ? "Entrevista concluída. Seu perfil foi salvo no banco de talentos."
          : result.decision === "ESCALATED"
          ? "Entrevista concluída. Seu perfil será analisado por um recrutador humano."
          : "Entrevista concluída. Obrigado pela participação."
      );

      setTimeout(() => {
        setShowAIInterview(false);
        onOpenChange(false);
        onScheduled?.();
      }, 5000);
    } catch (e: any) {
      toast.error("Erro ao registrar resultado da entrevista.");
    }
  };

  const aiInterviewConfig: InterviewConfig = {
    jobTitle: jobTitle || "Cargo",
    jobDescription: jobDescription || undefined,
    approveThreshold: 75,
    talentPoolThreshold: 50,
    guideBlocks: interviewGuide?.guide_json?.blocks || undefined,
    escalationScoreMargin: Number(govSettings?.escalation_score_margin ?? 0),
    escalationOnInconsistency: govSettings?.escalation_on_inconsistency === true || govSettings?.escalation_on_inconsistency === "true",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!showAIInterview) onOpenChange(o); }}>
      <DialogContent className={showAIInterview ? "max-w-2xl max-h-[90vh]" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {showAIInterview ? (
              <><Bot className="h-5 w-5" />Entrevista com IA</>
            ) : isBatePapo ? (
              <><CalendarDays className="h-5 w-5" />Agendar bate-papo</>
            ) : (
              <><CalendarDays className="h-5 w-5" />Agendar Entrevista</>
            )}
          </DialogTitle>
        </DialogHeader>

        {showAIInterview ? (
          <ScrollArea className="max-h-[75vh]">
            <AIInterviewScreen
              config={aiInterviewConfig}
              onComplete={handleAIInterviewComplete}
              onAbort={() => { setShowAIInterview(false); }}
            />
          </ScrollArea>
        ) : (
        <div className="max-h-[70vh] overflow-y-auto">
        {!unitId ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>Não foi possível identificar a unidade desta vaga. Recarregue a página e tente novamente.</AlertDescription>
          </Alert>
        ) : noShowLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : isBlocked ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>{noShowStatus?.message}</AlertDescription>
          </Alert>
        ) : unitSlots && unitSlots.length === 0 ? (
          <Alert>
            <Clock className="h-4 w-4" />
            <AlertDescription>
              Esta unidade ainda não cadastrou horários de entrevista. Aguarde — assim que o recrutador disponibilizar horários, você será notificado(a).
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

              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <label className="text-sm font-medium">Modalidade</label>
                <div className="flex flex-wrap gap-2">
                {(selectedSlot?.modality === "presencial" || selectedSlot?.modality === "ambos") && (
                  <Button
                    type="button"
                      size="sm"
                    variant={modality === "presencial" ? "default" : "outline"}
                      className="justify-center"
                    onClick={() => setModality("presencial")}
                  >
                    <MapPin className="h-4 w-4 mr-2" />
                    Presencial
                  </Button>
                )}
                {allowOnline && (selectedSlot?.modality === "online" || selectedSlot?.modality === "ambos") && (
                  <Button
                    type="button"
                      size="sm"
                    variant={modality === "online" ? "default" : "outline"}
                      className="justify-center"
                    onClick={() => setModality("online")}
                  >
                    <Video className="h-4 w-4 mr-2" />
                    Online
                  </Button>
                )}
              </div>
              {aiInterviewEnabled && !isBatePapo && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground"
                  onClick={() => setShowAIInterview(true)}
                >
                  <Bot className="h-4 w-4 mr-2" />
                  Entrevista IA
                </Button>
              )}
            </div>

            {modality === "online" && (
              <Alert>
                <Video className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  O link da reunião será enviado pelo recrutador assim que sua entrevista for aprovada.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setConfirming(false); setModality("presencial"); }}>Voltar</Button>
              <Button className="flex-1" onClick={handleConfirm} disabled={scheduleInterview.isPending}>
                {scheduleInterview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                {approvalSettings?.requireApproval ? "Solicitar Aprovação" : "Confirmar"}
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
                const today = new Date();
                today.setHours(0, 0, 0, 0);
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
                {selectedDate
                  ? `Horários disponíveis em ${format(selectedDate, "dd/MM")}:`
                  : "Selecione uma data para ver os horários:"}
              </p>
              {selectedDate && timesLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : availableSlots && availableSlots.length === 0 && selectedDate ? (
                <p className="text-sm text-muted-foreground text-center py-4">Não há mais horários disponíveis para esta data. Escolha outra.</p>
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
              <Button className="w-full" onClick={() => setConfirming(true)}>
                Avançar para confirmação
              </Button>
            )}
          </div>
        )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
