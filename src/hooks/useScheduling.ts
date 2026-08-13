import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAdminRecipientIds } from "@/lib/notificationRoutes";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { fetchScheduleGroupUnitIds } from "@/hooks/useScheduleGroups";

// --- Helper: parse setting value ---
function getSettingValue(settings: any[] | undefined, key: string, fallback: any = null) {
  if (!settings) return fallback;
  const s = settings.find((s: any) => s.key === key);
  if (!s) return fallback;
  const v = s.value;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

// Converte string de hora "HH:MM" ou "HH:MM:SS" para minutos totais
function timeToMinutes(t: string): number {
  if (!t || !t.includes(":")) return 0;
  const parts = t.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

// --- Availability Slots ---

export function useAvailabilitySlots(unitId?: string, slotType: "interview" | "test" = "interview") {
  return useQuery({
    queryKey: ["availability_slots", unitId, slotType],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("availability_slots")
        .select("*, units(id, name)")
        .eq("unit_id", unitId!)
        .eq("is_active", true)
        .eq("slot_type", slotType)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data || []).slice().sort((a: any, b: any) => {
        const an = (a.units?.name || "").toLowerCase();
        const bn = (b.units?.name || "").toLowerCase();
        if (an !== bn) return an.localeCompare(bn, "pt-BR");
        if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
        return String(a.start_time || "").localeCompare(String(b.start_time || ""));
      });
    },
  });
}

export function useAllSlots(unitId?: string, unitIds?: string[], slotType: "interview" | "test" = "interview") {
  return useQuery({
    queryKey: ["availability_slots_all", unitId, unitIds, slotType],
    queryFn: async () => {
      let q: any = (supabase as any)
        .from("availability_slots")
        .select("*, units(id, name)")
        .eq("is_active", true)
        .eq("slot_type", slotType)
        .order("day_of_week")
        .order("start_time");
      if (unitId) q = q.eq("unit_id", unitId);
      else if (unitIds && unitIds.length > 0) q = q.in("unit_id", unitIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).slice().sort((a: any, b: any) => {
        const an = (a.units?.name || "").toLowerCase();
        const bn = (b.units?.name || "").toLowerCase();
        if (an !== bn) return an.localeCompare(bn, "pt-BR");
        if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
        return String(a.start_time || "").localeCompare(String(b.start_time || ""));
      });
    },
  });
}

export function useCreateSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: {
      unit_id: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
      modality: string;
      auto_confirm?: boolean;
      slot_type?: "interview" | "test";
    }) => {
      console.log("[ADMIN][availability_slots] CRIANDO horário", slot);
      const { data, error } = await supabase
        .from("availability_slots")
        .insert({ slot_type: "interview", ...slot } as any)
        .select()
        .single();
      console.log("[ADMIN][availability_slots] RESPOSTA criação horário", { enviado: slot, data, error });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["availability_slots"] });
      qc.invalidateQueries({ queryKey: ["availability_slots_all"] });
    },
  });
}

export function useUpdateSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; is_active?: boolean; start_time?: string; end_time?: string; modality?: string; day_of_week?: number; auto_confirm?: boolean }) => {
      console.log("[ADMIN][availability_slots] ATUALIZANDO horário", { id, updates });
      const { data, error } = await supabase
        .from("availability_slots")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      console.log("[ADMIN][availability_slots] RESPOSTA atualização horário", { id, enviado: updates, data, error });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["availability_slots"] });
      qc.invalidateQueries({ queryKey: ["availability_slots_all"] });
    },
  });
}

export function useDeleteSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      console.log("[ADMIN][availability_slots] REMOVENDO horário", { id, update: { is_active: false } });
      const { error } = await supabase
        .from("availability_slots")
        .update({ is_active: false } as any)
        .eq("id", id);
      console.log("[ADMIN][availability_slots] RESPOSTA remoção horário", { id, error });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["availability_slots"] });
      qc.invalidateQueries({ queryKey: ["availability_slots_all"] });
    },
  });
}

// --- Interviews ---

export function useInterviews(filters?: { unitId?: string; unitIds?: string[]; status?: string; dateFrom?: string; dateTo?: string }) {
  return useQuery({
    queryKey: ["interviews", filters],
    queryFn: async () => {
      let q = supabase
        .from("interviews")
        .select("*, profiles(id, full_name, email, phone), units(id, name), applications(id, status, unit_job_id, unit_jobs(id, jobs(id, title)))")
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true });
      if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
      else if (filters?.unitIds && filters.unitIds.length > 0) q = q.in("unit_id", filters.unitIds);
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.dateFrom) q = q.gte("scheduled_date", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("scheduled_date", filters.dateTo);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

// Lista paginada (infinite scroll) priorizando entrevistas futuras (>= hoje, asc)
// e depois passadas (< hoje, desc). Evita carregar todos os registros de uma vez.
export function useInterviewsInfinite(
  filters?: { unitId?: string; unitIds?: string[]; status?: string; dateFrom?: string; dateTo?: string; name?: string },
  pageSize = 30,
) {
  const hasDateFilter = !!(filters?.dateFrom || filters?.dateTo);
  return useInfiniteQuery({
    queryKey: ["interviews_infinite", filters, pageSize],
    initialPageParam: { phase: (hasDateFilter ? "range" : "upcoming") as "upcoming" | "past" | "range", offset: 0 },
    queryFn: async ({ pageParam }) => {
      const today = new Date();
      const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const nameQ = filters?.name?.trim();
      const profilesJoin = nameQ ? "profiles!inner(id, full_name, email, phone)" : "profiles(id, full_name, email, phone)";
      let q = supabase
        .from("interviews")
        .select(`*, ${profilesJoin}, units(id, name), applications(id, status, unit_job_id, unit_jobs(id, jobs(id, title)))`);
      if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
      else if (filters?.unitIds && filters.unitIds.length > 0) q = q.in("unit_id", filters.unitIds);
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.dateFrom) q = q.gte("scheduled_date", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("scheduled_date", filters.dateTo);
      if (nameQ) q = q.ilike("profiles.full_name", `%${nameQ}%`);

      if (pageParam.phase === "range") {
        // Quando o usuário define um intervalo, respeita apenas os limites informados
        // (sem dividir em passado/futuro) para que datas anteriores e posteriores apareçam.
        q = q
          .order("scheduled_date", { ascending: true })
          .order("scheduled_time", { ascending: true });
      } else if (pageParam.phase === "upcoming") {
        q = q
          .gte("scheduled_date", todayYMD)
          .order("scheduled_date", { ascending: true })
          .order("scheduled_time", { ascending: true });
      } else {
        q = q
          .lt("scheduled_date", todayYMD)
          .order("scheduled_date", { ascending: false })
          .order("scheduled_time", { ascending: false });
      }
      q = q.range(pageParam.offset, pageParam.offset + pageSize - 1);
      const { data, error } = await q;
      if (error) throw error;
      return { rows: data || [], phase: pageParam.phase, pageSize };
    },
    getNextPageParam: (last, _all, lastParam: any) => {
      if (last.rows.length === last.pageSize) {
        return { phase: lastParam.phase, offset: lastParam.offset + last.pageSize };
      }
      if (lastParam.phase === "upcoming") {
        return { phase: "past" as const, offset: 0 };
      }
      return undefined;
    },
  });
}

// Contagens leves para os cards do topo (sem trazer linhas).
export function useInterviewsStats(filters?: { unitId?: string; unitIds?: string[] }) {
  return useQuery({
    queryKey: ["interviews_stats", filters],
    queryFn: async () => {
      const today = new Date();
      const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const base = () => {
        let q = supabase.from("interviews").select("id", { count: "exact", head: true });
        if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
        else if (filters?.unitIds && filters.unitIds.length > 0) q = q.in("unit_id", filters.unitIds);
        return q;
      };
      const [todayRes, noShowRes, totalRes] = await Promise.all([
        base().eq("scheduled_date", todayYMD).eq("status", "confirmed"),
        base().eq("status", "no_show"),
        base(),
      ]);
      return {
        today: todayRes.count ?? 0,
        noShow: noShowRes.count ?? 0,
        total: totalRes.count ?? 0,
      };
    },
  });
}

export function useMyInterviews() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_interviews", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interviews")
        .select("*, units(id, name, city, state), applications(id, unit_job_id, unit_jobs(id, jobs(id, title)))")
        .eq("candidate_id", user!.id)
        .order("scheduled_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useInterviewForApplication(applicationId?: string) {
  return useQuery({
    queryKey: ["interview_for_app", applicationId],
    enabled: !!applicationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interviews")
        .select("*")
        .eq("application_id", applicationId!)
        .in("status", ["confirmed", "rescheduled", "pending_approval"])
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// --- Schedule Interview with validations ---

export function useScheduleInterview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (interview: {
      application_id: string;
      candidate_id: string;
      unit_id: string;
      slot_id?: string;
      scheduled_date: string;
      scheduled_time: string;
      modality: string;
      meeting_link?: string;
      /**
       * Diferencia o compromisso: 'entrevista' (default) reutiliza todo o fluxo
       * atual; 'bate_papo' é o agendamento pós-teste online, persistido na
       * mesma tabela `interviews` para herdar disponibilidade/conflitos/notificações.
       */
      purpose?: "entrevista" | "bate_papo";
      _isCandidateSelfSchedule?: boolean; // flag interna para controle de fluxo
    }) => {
      const isCandidateScheduling = interview._isCandidateSelfSchedule === true;
      // 1. Load calendar settings
      const { data: calSettings } = await supabase
        .from("global_settings")
        .select("*")
        .eq("category", "calendar");

      const schedulingEnabled = getSettingValue(calSettings, "scheduling_enabled", true);
      if (schedulingEnabled === false) {
        throw new Error("O agendamento está temporariamente desativado pelo sistema.");
      }

      // 2. Check no-show response window
      // Regra correta: no-show abre uma janela de 24h para remarcar. Durante a
      // janela, o agendamento desta mesma application deve ser permitido. Após o
      // deadline, bloqueia apenas essa remarcação até o cron mover para standby.
      const noShowTrackingEnabled = getSettingValue(calSettings, "no_show_tracking_enabled", true);

      // Busca no_show pendente desta application (para exempt + marcar resolução depois)
      const { data: pendingNoShow } = await supabase
        .from("interviews")
        .select("id, no_show_response_deadline, no_show_resolution, updated_at")
        .eq("application_id", interview.application_id)
        .eq("status", "no_show")
        .is("no_show_resolution", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nowMs = Date.now();
      const isWithinReschedWindow = !!(
        pendingNoShow?.no_show_response_deadline &&
        new Date(pendingNoShow.no_show_response_deadline).getTime() > nowMs
      );

      if (noShowTrackingEnabled !== false && pendingNoShow && !isWithinReschedWindow) {
        await supabase.from("calendar_logs").insert({
          user_id: interview.candidate_id,
          event_type: "block",
          rule_applied: "no_show_response_window_expired",
          context: {
            original_interview_id: pendingNoShow.id,
            deadline: pendingNoShow.no_show_response_deadline,
          },
        } as any);
        throw new Error("O prazo de 24h para remarcar esta entrevista expirou. Seu processo será movido para standby.");
      }

      // Guardamos o id do no_show pendente para resolução pós-insert
      (interview as any)._resolveNoShowId = pendingNoShow?.id || null;

      // 3. Validate candidate_id from application
      const { data: app } = await supabase
        .from("applications")
        .select("candidate_id")
        .eq("id", interview.application_id)
        .single();
      if (app) {
        interview.candidate_id = app.candidate_id;
      }

      // 3b. Cancel any existing active interviews for the same application (reschedule scenario)
      const { data: activeInterviews } = await supabase
        .from("interviews")
        .select("id")
        .eq("application_id", interview.application_id)
        .in("status", ["confirmed", "reschedule_requested", "pending_approval"]);
      if (activeInterviews && activeInterviews.length > 0) {
        for (const ai of activeInterviews) {
          await supabase.from("interviews").update({ status: "rescheduled" } as any).eq("id", ai.id);
        }
      }

      // 4. Determina status inicial.
      //    - Quando o slot escolhido tem `auto_confirm = true`, o AGENDAMENTO é
      //      confirmado automaticamente (ETAPA 1 — escolha de data/horário sempre
      //      automática quando o slot permite).
      //    - Caso contrário, fica `pending_approval` para o recrutador confirmar.
      //    - A APROVAÇÃO DO RESULTADO da entrevista permanece SEMPRE manual e é
      //      registrada em `interview_feedback` (ETAPA 2 — não confundir com a
      //      confirmação do agendamento).
      let slotAutoConfirm = false;
      if (interview.slot_id) {
        const { data: slotRow } = await (supabase as any)
          .from("availability_slots")
          .select("auto_confirm")
          .eq("id", interview.slot_id)
          .maybeSingle();
        slotAutoConfirm = !!slotRow?.auto_confirm;
      }
      let initialStatus = "confirmed";
      let requiresApproval = false;
      if (isCandidateScheduling && !slotAutoConfirm) {
        initialStatus = "pending_approval";
        requiresApproval = true;
      }
      // Remove internal flags before insert
      const { _isCandidateSelfSchedule, _resolveNoShowId, ...interviewData } = interview as any;

      // Conflito de horário (incluindo agenda unificada) é garantido pelo
      // trigger `prevent_active_interview_double_booking` no banco. O cliente
      // não consegue ler entrevistas de outros candidatos (RLS), então não há
      // checagem prévia confiável aqui — confiamos no INSERT abaixo e
      // traduzimos o erro de conflito para uma mensagem amigável.

      // 5. Insert interview — confirmed_at NUNCA é preenchido automaticamente;
      // o candidato precisa clicar em "Confirmar presença" no card da entrevista.
      // Para entrevistas ONLINE auto-confirmadas, já gravamos provider=livekit
      // e meeting_link relativo ('/entrevista-online/:id'). Sem isso a sala
      // nunca é gerada porque resolveMeetingHref/isLivekitInterview ficam falsos.
      const isOnline = interviewData.modality === "online";
      const { data, error } = await supabase
        .from("interviews")
        .insert({
          ...interviewData,
          status: initialStatus,
          ...(isOnline
            ? { meeting_provider: "livekit", meeting_link: null }
            : {}),
        } as any)
        .select()
        .single();
      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("já existe uma entrevista") || (error as any).code === "23505") {
          // Invalida a disponibilidade para forçar refetch — o slot está realmente
          // ocupado no grupo de agenda (race com outro candidato ou cache obsoleto).
          qc.invalidateQueries({ queryKey: ["available_times"] });
          qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
          throw new Error("Esse horário acabou de ser ocupado por outro candidato. Escolha outro horário.");
        }
        throw error;
      }

      // 5a. Preenche meeting_link com o path da sala LiveKit agora que temos o id.
      if (isOnline && data?.id) {
        const livekitPath = `/entrevista-online/${data.id}`;
        const { data: updated } = await supabase
          .from("interviews")
          .update({ meeting_link: livekitPath, meeting_provider: "livekit" } as any)
          .eq("id", data.id)
          .select()
          .single();
        if (updated) {
          (data as any).meeting_link = updated.meeting_link;
          (data as any).meeting_provider = updated.meeting_provider;
        }
      }

      // 5a-bis. Se a remarcação resolve um no-show pendente, marca a entrada original
      // como resolvida ("rescheduled") para que o cron `enforce-no-show-deadline`
      // não mova essa application para standby.
      if (_resolveNoShowId) {
        await supabase
          .from("interviews")
          .update({ no_show_resolution: "rescheduled" } as any)
          .eq("id", _resolveNoShowId)
          .is("no_show_resolution", null);
        await supabase.from("calendar_logs").insert({
          user_id: interviewData.candidate_id,
          event_type: "no_show_rescheduled",
          rule_applied: "no_show_response_window",
          context: { original_interview_id: _resolveNoShowId, new_interview_id: data.id },
        } as any);
      }

      // 5b. Log event in interview_events_log
      await supabase.from("interview_events_log" as any).insert({
        interview_id: data.id,
        event_type: requiresApproval ? "pending_approval" : "scheduled",
        actor_id: user?.id || interviewData.candidate_id || null,
        previous_status: null,
        new_status: initialStatus,
        metadata: { date: interviewData.scheduled_date, time: interviewData.scheduled_time, is_candidate: isCandidateScheduling },
      });

      // 5c. Log success
      await supabase.from("calendar_logs").insert({
        user_id: interviewData.candidate_id,
        event_type: requiresApproval ? "pending_approval" : "schedule",
        rule_applied: requiresApproval ? "require_interview_approval" : null,
        context: { interview_id: data.id, date: interviewData.scheduled_date, time: interviewData.scheduled_time, unit_id: interviewData.unit_id },
      } as any);

      // 6. Notify based on workflow
      if (requiresApproval) {
        // Notify admins about pending approval
        try {
          const recipientIds = await getAdminRecipientIds(interviewData.unit_id);
          const { data: candidateProfile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", interviewData.candidate_id)
            .single();

          for (const rid of recipientIds) {
            if (rid === interviewData.candidate_id) continue;
            await supabase.from("notifications" as any).insert({
              event_type: "interview_pending_approval",
              recipient_id: rid,
              channel: "push",
              title: "Agendamento pendente de aprovação",
              body: `${candidateProfile?.full_name || "Candidato"} solicitou entrevista para ${interviewData.scheduled_date} às ${interviewData.scheduled_time.slice(0, 5)}.`,
              status: "pending",
              action_url: "/admin/agendamento",
              action_type: "action_required",
              payload: { interview_id: data.id, date: interviewData.scheduled_date, time: interviewData.scheduled_time, requires_approval: true },
            } as any);
          }
        } catch (e) {
          console.warn("Failed to notify admins about pending approval:", e);
        }
      } else {
        // Notificação a admins + WhatsApp/email ao candidato são disparados
        // pelo pipeline server-side (evento `interview_scheduled` + `interview_scheduled_admin`).
        // Ver memória `pipeline-templates-whatsapp-entrevistas` e `hsm-entrevista-apenas-candidato`.
        // Chamadas duplicadas a send-whatsapp/send-email a partir do client foram removidas
        // (retornavam 403 e geravam disparo duplo).
      } // end else (non-approval flow)


      // Dispatch automation event
      import("@/lib/automationEngine").then(({ dispatchAutomationEvent }) => {
        dispatchAutomationEvent(requiresApproval ? "interview_pending_approval" : "interview_scheduled", {
          interview_id: data.id,
          candidate_id: interviewData.candidate_id,
          unit_id: interviewData.unit_id,
          application_id: interviewData.application_id,
          date: interviewData.scheduled_date,
          time: interviewData.scheduled_time,
          requires_approval: requiresApproval,
        }).catch(() => {});
      });

      // Google Calendar sync (if enabled)
      if (!requiresApproval) {
        try {
          const { data: syncSetting } = await supabase
            .from("global_settings")
            .select("value")
            .eq("category", "calendar")
            .eq("key", "calendar_sync_enabled")
            .maybeSingle();
          const syncEnabled = syncSetting?.value === true || syncSetting?.value === "true";
          if (syncEnabled) {
            supabase.functions.invoke("google-calendar-sync", {
              body: { action: "sync_event", interview_id: data.id },
            }).catch((e: any) => console.warn("GCal sync failed:", e));
          }
        } catch { /* ignore sync errors */ }
      }

      return { ...data, requiresApproval };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["interviews_infinite"] });
      qc.invalidateQueries({ queryKey: ["interviews_stats"] });
      qc.invalidateQueries({ queryKey: ["interviews_by_month"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_for_app"] });
      qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
      qc.invalidateQueries({ queryKey: ["available_times"] });
    },
  });
}

export function useUpdateInterview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; notes?: string; meeting_link?: string }) => {
      const { data, error } = await supabase
        .from("interviews")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["interviews_infinite"] });
      qc.invalidateQueries({ queryKey: ["interviews_stats"] });
      qc.invalidateQueries({ queryKey: ["interviews_by_month"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_for_app"] });
      if (vars.status) {
        supabase.from("activity_logs").insert({
          user_id: user?.id || null,
          action: `entrevista_${vars.status}`,
          module: "entrevistas",
          details: { interview_id: vars.id, status: vars.status },
        } as any).then(() => {});
      }
    },
  });
}

export function useCancelInterview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("interviews")
        .update({ status: "cancelled" } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      await supabase.from("calendar_logs").insert({
        user_id: user?.id || null,
        event_type: "cancel",
        rule_applied: null,
        context: { interview_id: id },
      } as any);

      return data;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["interviews_infinite"] });
      qc.invalidateQueries({ queryKey: ["interviews_stats"] });
      qc.invalidateQueries({ queryKey: ["interviews_by_month"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_for_app"] });
      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "entrevista_cancelled",
        module: "entrevistas",
        details: { interview_id: id },
      } as any).then(() => {});
    },
  });
}

export function useRescheduleInterview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ interviewId, newDate, newTime, newSlotId, newModality, reason }: {
      interviewId: string;
      newDate: string;
      newTime: string;
      newSlotId?: string;
      newModality?: string;
      reason?: string;
    }) => {
      const { data: calSettings } = await supabase
        .from("global_settings")
        .select("*")
        .eq("category", "calendar");

      const { data: auditSettings } = await supabase
        .from("global_settings")
        .select("*")
        .eq("category", "interview_audit");

      const allowReschedule = getSettingValue(calSettings, "allow_reschedule", true);
      if (allowReschedule === false) {
        throw new Error("A remarcação de entrevistas está desativada pelo sistema.");
      }

      const rescheduleMinHours = Number(getSettingValue(calSettings, "reschedule_min_hours", 24));
      const maxRescheduleAllowed = Number(getSettingValue(auditSettings, "max_reschedule_allowed", 3));

      const { data: current, error: fetchErr } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", interviewId)
        .single();
      if (fetchErr) throw fetchErr;

      const now = new Date();
      const confirmedAtRaw = (current as any).confirmed_at as string | null | undefined;
      if (!confirmedAtRaw) {
        await supabase.from("calendar_logs").insert({
          user_id: user?.id || null,
          event_type: "block",
          rule_applied: "reschedule_requires_confirmation",
          context: { interview_id: interviewId },
        } as any);
        throw new Error("Aguarde a confirmação da entrevista antes de remarcar.");
      }
      const confirmedAt = new Date(confirmedAtRaw);
      const hoursSinceConfirmation = (now.getTime() - confirmedAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceConfirmation < rescheduleMinHours) {
        const remaining = Math.max(1, Math.ceil(rescheduleMinHours - hoursSinceConfirmation));
        await supabase.from("calendar_logs").insert({
          user_id: user?.id || null,
          event_type: "block",
          rule_applied: `reschedule_min_hours:${rescheduleMinHours}`,
          context: {
            interview_id: interviewId,
            hours_since_confirmation: Math.round(hoursSinceConfirmation),
            confirmed_at: confirmedAtRaw,
          },
        } as any);
        throw new Error(
          `Você poderá remarcar esta entrevista em ${remaining}h. O tempo mínimo de ${rescheduleMinHours}h é contado a partir da confirmação.`
        );
      }

      const { data: rescheduleHistory } = await supabase
        .from("calendar_logs")
        .select("id")
        .eq("event_type", "reschedule")
        .contains("context", { interview_id: interviewId } as any);

      const rescheduleCount = (rescheduleHistory?.length || 0);
      if (rescheduleCount >= maxRescheduleAllowed) {
        await supabase.from("calendar_logs").insert({
          user_id: user?.id || null,
          event_type: "block",
          rule_applied: `max_reschedule_allowed:${maxRescheduleAllowed}`,
          context: { interview_id: interviewId, reschedule_count: rescheduleCount },
        } as any);
        throw new Error(`Limite de ${maxRescheduleAllowed} reagendamentos atingido para esta entrevista.`);
      }

      // Reagendamento solicitado pelo candidato → entra em pending_approval.
      // O recrutador precisa aprovar (e fornecer link de reunião, se online)
      // antes de notificar o candidato como "remarcada/confirmada".
      const updates: any = {
        scheduled_date: newDate,
        scheduled_time: newTime,
        status: "pending_approval",
        // Limpa aprovação anterior e link da reunião (precisa nova aprovação)
        approved_at: null,
        approved_by: null,
        meeting_link: null,
      };
      if (newSlotId) updates.slot_id = newSlotId;
      if (newModality) updates.modality = newModality;
      if (reason) updates.reschedule_reason = reason;

      const { data, error } = await supabase
        .from("interviews")
        .update(updates)
        .eq("id", interviewId)
        .select()
        .single();
      if (error) throw error;

      await supabase.from("calendar_logs").insert({
        user_id: user?.id || null,
        event_type: "reschedule",
        rule_applied: "require_interview_approval",
        context: {
          interview_id: interviewId,
          old_date: current.scheduled_date,
          old_time: current.scheduled_time,
          new_date: newDate,
          new_time: newTime,
          reschedule_number: rescheduleCount + 1,
          reason: reason || null,
        },
      } as any);

      // Log in interview_events_log
      await supabase.from("interview_events_log" as any).insert({
        interview_id: interviewId,
        event_type: "reschedule",
        actor_id: user?.id || current.candidate_id,
        previous_status: current.status,
        new_status: "pending_approval",
        metadata: { old_date: current.scheduled_date, old_time: current.scheduled_time, new_date: newDate, new_time: newTime, requires_approval: true },
      });

      // Notify recruiters/admins about pending reschedule approval
      try {
        const recipientIds = await getAdminRecipientIds(current.unit_id);
        const { data: candidateProfile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", current.candidate_id)
          .single();

        for (const rid of recipientIds) {
          if (rid === current.candidate_id) continue;
          await supabase.from("notifications" as any).insert({
            event_type: "interview_pending_approval",
            recipient_id: rid,
            channel: "push",
            title: "Reagendamento aguardando aprovação",
            body: `${candidateProfile?.full_name || "Candidato"} solicitou remarcar a entrevista para ${newDate} às ${newTime.slice(0, 5)}.`,
            status: "pending",
            action_url: "/admin/agendamento",
            action_type: "action_required",
            payload: {
              interview_id: interviewId,
              date: newDate,
              time: newTime,
              requires_approval: true,
              is_reschedule: true,
            },
          } as any);
        }
      } catch (e) {
        console.warn("Failed to notify admins about pending reschedule:", e);
      }

      // Dispatch automation event
      import("@/lib/automationEngine").then(({ dispatchAutomationEvent }) => {
        dispatchAutomationEvent("interview_rescheduled", {
          interview_id: interviewId,
          new_date: newDate,
          new_time: newTime,
          reschedule_number: rescheduleCount + 1,
        }).catch(() => {});
      });

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["interviews_infinite"] });
      qc.invalidateQueries({ queryKey: ["interviews_stats"] });
      qc.invalidateQueries({ queryKey: ["interviews_by_month"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_for_app"] });
      qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
      qc.invalidateQueries({ queryKey: ["available_times"] });
    },
  });
}

// --- Availability calculation with buffer + daily limit ---

export function useAvailableTimes(unitId?: string, date?: string, options?: { bypassLeadTime?: boolean; excludeInterviewId?: string; purpose?: "entrevista" | "bate_papo" }) {
  return useQuery({
    queryKey: ["available_times", unitId, date, options?.bypassLeadTime === true, options?.excludeInterviewId || null, options?.purpose || "entrevista"],
    enabled: !!unitId && !!date,
    queryFn: async () => {
      // Disponibilidade é calculada no banco (SECURITY DEFINER). Conflitos
      // são separados por `purpose`: entrevista só bloqueia entrevista,
      // bate_papo só bloqueia bate_papo.
      const { data, error } = await (supabase as any).rpc("get_available_interview_times", {
        _unit_id: unitId!,
        _date: date!,
        _bypass_lead_time: options?.bypassLeadTime === true,
        _exclude_interview_id: options?.excludeInterviewId || null,
        _purpose: options?.purpose || "entrevista",
      });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        slotId: row.slot_id,
        startTime: row.start_time,
        endTime: row.end_time,
        modality: row.modality,
      }));
    },
  });
}

// --- Unavailable dates (whole-day) for the candidate calendar ---

/**
 * Computes the set of dates (yyyy-MM-dd) within the next `daysAhead` days
 * that have ZERO available interview slots — including today when all slots
 * are already in the past (respecting min_lead_time_minutes), and future days
 * fully booked / blocked by buffer/min_gap/daily limit.
 *
 * Days disabled by other rules (past, blocked_dates, day-of-week without slots)
 * are intentionally NOT included here — those are handled in the component.
 */
export function useUnavailableDates(unitId?: string, daysAhead: number = 90, options?: { bypassLeadTime?: boolean; excludeInterviewId?: string; purpose?: "entrevista" | "bate_papo" }) {
  return useQuery({
    queryKey: ["unavailable_dates", unitId, daysAhead, options?.bypassLeadTime === true, options?.excludeInterviewId || null, options?.purpose || "entrevista"],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_unavailable_interview_dates", {
        _unit_id: unitId!,
        _days_ahead: daysAhead,
        _bypass_lead_time: options?.bypassLeadTime === true,
        _exclude_interview_id: options?.excludeInterviewId || null,
        _purpose: options?.purpose || "entrevista",
      });
      if (error) throw error;
      const set = new Set<string>();
      (data || []).forEach((row: any) => {
        if (row?.unavailable_date) set.add(row.unavailable_date);
      });
      return set;
    },
    staleTime: 30_000,
  });
}

// --- Interviews by month (for unified agenda) ---

export function useInterviewsByMonth(unitId?: string, year?: number, month?: number, unitIds?: string[]) {
  return useQuery({
    queryKey: ["interviews_by_month", unitId, year, month, unitIds],
    enabled: year != null && month != null,
    queryFn: async () => {
      const startDate = `${year}-${String(month! + 1).padStart(2, "0")}-01`;
      const endDate = month === 11
        ? `${year! + 1}-01-31`
        : `${year}-${String(month! + 2).padStart(2, "0")}-01`;

      let q = supabase
        .from("interviews")
        .select("*, profiles(id, full_name, email), units(id, name), applications(id, unit_job_id, unit_jobs(id, jobs(id, title)))")
        .gte("scheduled_date", startDate)
        .lt("scheduled_date", endDate)
        .order("scheduled_date")
        .order("scheduled_time");
      if (unitId) q = q.eq("unit_id", unitId);
      else if (unitIds && unitIds.length > 0) q = q.in("unit_id", unitIds);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

// --- Booked times for a given unit + date ---

export function useBookedTimes(unitId?: string, date?: string) {
  return useQuery({
    queryKey: ["booked_times", unitId, date],
    enabled: !!unitId && !!date,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interviews")
        .select("scheduled_time")
        .eq("unit_id", unitId!)
        .eq("scheduled_date", date!)
        .in("status", ["confirmed"]);
      if (error) throw error;
      return (data || []).map((i: any) => i.scheduled_time as string);
    },
  });
}

// --- No-show check hook for UI ---

// --- Confirm Attendance ---

export function useConfirmAttendance() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (interviewId: string) => {
      const { data, error } = await supabase
        .from("interviews")
        .update({ confirmed_at: new Date().toISOString() } as any)
        .eq("id", interviewId)
        .select()
        .single();
      if (error) throw error;

      // Log confirmation
      await supabase.from("calendar_logs").insert({
        user_id: user?.id || null,
        event_type: "confirm_attendance",
        rule_applied: null,
        context: { interview_id: interviewId },
      } as any);

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["interviews_infinite"] });
      qc.invalidateQueries({ queryKey: ["interviews_by_month"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_for_app"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["candidate_timeline"] });
      qc.invalidateQueries({ queryKey: ["candidate_interviews"] });
      qc.invalidateQueries({ queryKey: ["candidate_interviews_batch"] });
      qc.invalidateQueries({ queryKey: ["scheduling_interview_decisions"] });
      qc.invalidateQueries({ queryKey: ["interview_feedback_decisions"] });
    },
  });
}

export function useNoShowBlock(candidateId?: string, applicationId?: string) {
  return useQuery({
    queryKey: ["no_show_block", candidateId, applicationId],
    enabled: !!candidateId,
    queryFn: async () => {
      const { data: calSettings } = await supabase
        .from("global_settings")
        .select("*")
        .eq("category", "calendar");

      const noShowTrackingEnabled = getSettingValue(calSettings, "no_show_tracking_enabled", true);

      if (noShowTrackingEnabled === false) {
        return { blocked: false, message: null };
      }

      let q = supabase
        .from("interviews")
        .select("id, application_id, no_show_response_deadline, no_show_resolution, updated_at")
        .eq("candidate_id", candidateId!)
        .eq("status", "no_show")
        .is("no_show_resolution", null)
        .order("no_show_response_deadline", { ascending: false })
        .limit(1);
      if (applicationId) q = q.eq("application_id", applicationId);
      const { data: noShows } = await q;

      if (!noShows || noShows.length === 0) return { blocked: false, message: null };

      const deadline = noShows[0].no_show_response_deadline;
      if (deadline && new Date(deadline).getTime() <= Date.now()) {
        return {
          blocked: true,
          message: "O prazo de 24h para remarcar esta entrevista expirou. Seu processo será movido para standby.",
        };
      }

      return { blocked: false, message: null };
    },
  });
}

// --- Approval Workflow ---

/** Query: buscar entrevistas pendentes de aprovação */
export function usePendingApprovals(unitId?: string, unitIds?: string[]) {
  return useQuery({
    queryKey: ["pending_approvals", unitId, unitIds],
    queryFn: async () => {
      let q = supabase
        .from("interviews")
        .select("*, profiles(id, full_name, email, phone), units(id, name), applications(id, total_score, unit_job_id, unit_jobs(id, jobs(id, title)))")
        .eq("status", "pending_approval")
        .order("created_at", { ascending: true });
      if (unitId) q = q.eq("unit_id", unitId);
      else if (unitIds && unitIds.length > 0) q = q.in("unit_id", unitIds);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000, // Atualizar a cada 30s
  });
}

/** Mutation: aprovar entrevista pendente */
export function useApproveInterview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ interviewId, notes, meetingLink, meetingProvider }: { interviewId: string; notes?: string; meetingLink?: string; meetingProvider?: "livekit" | "external" }) => {
      // 1. Buscar entrevista atual
      const { data: interview, error: fetchErr } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", interviewId)
        .single();
      if (fetchErr) throw fetchErr;
      if (interview.status !== "pending_approval") {
        throw new Error("Esta entrevista não está pendente de aprovação.");
      }

      // 1b. Validar / preparar link da reunião quando online
      const isOnline = interview.modality === "online";
      const provider = isOnline ? (meetingProvider || "external") : null;

      // LiveKit: link interno é path relativo (resolvido no host de quem clica).
      // NÃO usar window.location.origin aqui — o admin pode estar em dev/IP local
      // e isso seria gravado no banco, quebrando o link para o candidato.
      let trimmedLink = (meetingLink || "").trim();
      if (isOnline && provider === "livekit") {
        trimmedLink = `/entrevista-online/${interviewId}`;
      }

      if (isOnline) {
        if (!trimmedLink) {
          throw new Error("Informe o link da reunião antes de aprovar uma entrevista online.");
        }
        if (provider !== "livekit" && !/^https?:\/\/\S+\.\S+/i.test(trimmedLink)) {
          throw new Error("O link da reunião precisa ser uma URL válida (começando com http:// ou https://).");
        }
      }

      // 2. Atualizar status para agendada (aprovada) e gravar link, se aplicável
      const updatePayload: any = { status: "confirmed", notes: notes || interview.notes };
      if (isOnline) {
        updatePayload.meeting_link = trimmedLink;
        updatePayload.meeting_provider = provider;
      }

      const { data, error } = await supabase
        .from("interviews")
        .update(updatePayload)
        .eq("id", interviewId)
        .select()
        .single();
      if (error) throw error;

      // 2b. Gate de integridade: só seguimos para notificação se a mudança
      // de status foi validada (id persistido + status = 'confirmed' + link válido se online).
      if (!data?.id || data.status !== "confirmed") {
        throw new Error("Falha ao confirmar entrevista — notificação suprimida.");
      }
      if (isOnline) {
        const linkOk = provider === "livekit"
          ? !!data.meeting_link && data.meeting_link.startsWith("/entrevista-online/")
          : !!data.meeting_link && /^https?:\/\/\S+\.\S+/i.test(data.meeting_link);
        if (!linkOk) {
          throw new Error("Link da reunião inválido — notificação suprimida.");
        }
      }

      // 3. Registrar evento de log
      await supabase.from("interview_events_log" as any).insert({
        interview_id: interviewId,
        event_type: "approved",
        actor_id: user?.id || null,
        previous_status: "pending_approval",
        new_status: "confirmed",
        reason: notes || null,
        metadata: { approved_at: new Date().toISOString(), meeting_link: isOnline ? trimmedLink : null },
      });

      // 4. Log no calendar_logs
      await supabase.from("calendar_logs").insert({
        user_id: user?.id || null,
        event_type: "approval",
        rule_applied: "interview_approved",
        context: { interview_id: interviewId, candidate_id: interview.candidate_id },
      } as any);

      // 4b. Detectar se a entrevista veio de um reagendamento
      let isReschedule = false;
      try {
        const { data: lastEvents } = await supabase
          .from("interview_events_log" as any)
          .select("event_type")
          .eq("interview_id", interviewId)
          .order("created_at", { ascending: false })
          .limit(5);
        if (Array.isArray(lastEvents)) {
          // se houve um reschedule depois do último 'approved' → é reagendamento
          const idxReschedule = lastEvents.findIndex((e: any) => e.event_type === "reschedule");
          const idxApproved = lastEvents.findIndex((e: any) => e.event_type === "approved");
          isReschedule = idxReschedule !== -1 && (idxApproved === -1 || idxReschedule < idxApproved);
        }
      } catch {}

      // 5. Notificar candidato - push
      try {
        const linkLine = isOnline ? `\nLink: ${trimmedLink}` : "";
        const title = isReschedule ? "Reagendamento confirmado! ✅" : "Entrevista aprovada! ✅";
        const bodyPrefix = isReschedule
          ? "Seu novo horário foi confirmado para"
          : "Sua entrevista foi confirmada para";
        await supabase.from("notifications" as any).insert({
          event_type: "interview_approved",
          recipient_id: interview.candidate_id,
          channel: "push",
          title,
          body: `${bodyPrefix} ${interview.scheduled_date} às ${interview.scheduled_time?.slice(0, 5)}.${linkLine}`,
          status: "pending",
          action_url: "/candidaturas",
          action_type: "success",
          payload: { interview_id: interviewId, date: interview.scheduled_date, time: interview.scheduled_time, meeting_link: isOnline ? trimmedLink : null, is_reschedule: isReschedule },
        });
      } catch (e) {
        console.warn("Failed to notify candidate about approval:", e);
      }

      // 6. Notificar candidato - WhatsApp
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("phone, full_name")
          .eq("id", interview.candidate_id)
          .single();
        if (profile?.phone) {
          const waPrefix = isReschedule
            ? "Seu reagendamento foi confirmado para"
            : "Sua entrevista foi confirmada para";
          await supabase.functions.invoke("send-whatsapp", {
            body: {
              phone: profile.phone,
              message: `Olá ${profile.full_name || ""}! ${waPrefix} ${interview.scheduled_date} às ${interview.scheduled_time?.slice(0, 5)}.${isOnline ? `\nLink da reunião: ${trimmedLink}` : ""} Boa sorte! 🍀`,
            },
          });
        }
      } catch (e) {
        console.warn("Failed to send WhatsApp for approval:", e);
      }

      // 7. Dispatch automation event
      import("@/lib/automationEngine").then(({ dispatchAutomationEvent }) => {
        dispatchAutomationEvent("interview_approved", {
          interview_id: interviewId,
          candidate_id: interview.candidate_id,
          unit_id: interview.unit_id,
          date: interview.scheduled_date,
          time: interview.scheduled_time,
        }).catch(() => {});
      });

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending_approvals"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_for_app"] });
      qc.invalidateQueries({ queryKey: ["approval_conflict"] });
      qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
      qc.invalidateQueries({ queryKey: ["available_times"] });
    },
  });
}

/** Mutation: rejeitar entrevista pendente */
export function useRejectInterview() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ interviewId, reason }: { interviewId: string; reason?: string }) => {
      // 1. Buscar entrevista atual
      const { data: interview, error: fetchErr } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", interviewId)
        .single();
      if (fetchErr) throw fetchErr;
      if (interview.status !== "pending_approval") {
        throw new Error("Esta entrevista não está pendente de aprovação.");
      }

      // 2. Atualizar status para cancelada (rejeitada)
      const { data, error } = await supabase
        .from("interviews")
        .update({ status: "cancelled", notes: reason || "Horário não aprovado pelo administrador" } as any)
        .eq("id", interviewId)
        .select()
        .single();
      if (error) throw error;

      // 3. Registrar evento de log
      await supabase.from("interview_events_log" as any).insert({
        interview_id: interviewId,
        event_type: "rejected",
        actor_id: user?.id || null,
        previous_status: "pending_approval",
        new_status: "cancelled",
        reason: reason || "Horário indisponível",
        metadata: { rejected_at: new Date().toISOString() },
      });

      // 4. Log no calendar_logs
      await supabase.from("calendar_logs").insert({
        user_id: user?.id || null,
        event_type: "rejection",
        rule_applied: "interview_rejected",
        context: { interview_id: interviewId, candidate_id: interview.candidate_id, reason },
      } as any);

      // 5. Verificar auto_reschedule_on_reject
      const { data: agendSettings } = await supabase
        .from("global_settings")
        .select("*")
        .eq("category", "agendamento");
      const autoReschedule = getSettingValue(agendSettings, "auto_reschedule_on_reject", true);

      // 6. Notificar candidato - push
      try {
        const bodyMsg = autoReschedule
          ? `O horário solicitado (${interview.scheduled_date} às ${interview.scheduled_time?.slice(0, 5)}) não está disponível. Por favor, escolha um novo horário.`
          : `O horário solicitado (${interview.scheduled_date} às ${interview.scheduled_time?.slice(0, 5)}) não está disponível. ${reason || ""}`;

        await supabase.from("notifications" as any).insert({
          event_type: "interview_rejected",
          recipient_id: interview.candidate_id,
          channel: "push",
          title: "Horário não disponível",
          body: bodyMsg,
          status: "pending",
          action_url: autoReschedule ? "/candidaturas" : undefined,
          action_type: autoReschedule ? "action_required" : "warning",
          payload: {
            interview_id: interviewId,
            date: interview.scheduled_date,
            time: interview.scheduled_time,
            can_reschedule: autoReschedule,
            application_id: interview.application_id,
          },
        });
      } catch (e) {
        console.warn("Failed to notify candidate about rejection:", e);
      }

      // 7. Notificar candidato - WhatsApp
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("phone, full_name")
          .eq("id", interview.candidate_id)
          .single();
        if (profile?.phone) {
          const msg = autoReschedule
            ? `Olá ${profile.full_name || ""}, o horário solicitado não está disponível. Por favor, acesse o app e escolha um novo horário.`
            : `Olá ${profile.full_name || ""}, o horário solicitado não está disponível. ${reason || "Entraremos em contato."}`;
          await supabase.functions.invoke("send-whatsapp", {
            body: { phone: profile.phone, message: msg },
          });
        }
      } catch (e) {
        console.warn("Failed to send WhatsApp for rejection:", e);
      }

      // 8. Dispatch automation event
      import("@/lib/automationEngine").then(({ dispatchAutomationEvent }) => {
        dispatchAutomationEvent("interview_rejected", {
          interview_id: interviewId,
          candidate_id: interview.candidate_id,
          unit_id: interview.unit_id,
          application_id: interview.application_id,
          reason,
          can_reschedule: autoReschedule,
        }).catch(() => {});
      });

      return { ...data, canReschedule: autoReschedule };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending_approvals"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_for_app"] });
      qc.invalidateQueries({ queryKey: ["approval_conflict"] });
      qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
      qc.invalidateQueries({ queryKey: ["available_times"] });
    },
  });
}

/** Query: buscar log de eventos de entrevista */
export function useInterviewEventsLog(interviewId?: string) {
  return useQuery({
    queryKey: ["interview_events_log", interviewId],
    enabled: !!interviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interview_events_log" as any)
        .select("*")
        .eq("interview_id", interviewId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

/** Query: configuração de aprovação */
export function useApprovalSettings() {
  return useQuery({
    queryKey: ["approval_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("*")
        .eq("category", "agendamento");
      if (error) throw error;
      return {
        requireApproval: getSettingValue(data, "require_interview_approval", true),
        autoRescheduleOnReject: getSettingValue(data, "auto_reschedule_on_reject", true),
        approvalTimeoutHours: Number(getSettingValue(data, "approval_timeout_hours", 12)),
        selfScheduleEnabled: getSettingValue(data, "allow_candidate_self_schedule", true),
      };
    },
  });
}
