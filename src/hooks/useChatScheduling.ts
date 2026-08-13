import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Bate-Papo Pós-Teste — hooks totalmente independentes da Entrevista.
// Nenhum hook exportado aqui compartilha query key com `useScheduling`.
// ---------------------------------------------------------------------------

export interface ChatSlot {
  id: string;
  unit_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  auto_confirm: boolean;
  is_active: boolean;
}

export function useChatSlots(unitId?: string, unitIds?: string[]) {
  return useQuery({
    queryKey: ["chat_availability_slots", unitId, unitIds],
    queryFn: async () => {
      let q: any = (supabase as any)
        .from("chat_availability_slots")
        .select("*, units(id, name)")
        .eq("is_active", true)
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

export function useCreateChatSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: { unit_id: string; day_of_week: number; start_time: string; end_time: string; auto_confirm?: boolean }) => {
      const { data, error } = await (supabase as any)
        .from("chat_availability_slots")
        .insert(slot)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat_availability_slots"] });
      qc.invalidateQueries({ queryKey: ["chat_available_times"] });
      qc.invalidateQueries({ queryKey: ["chat_unavailable_dates"] });
    },
  });
}

export function useUpdateChatSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; day_of_week?: number; start_time?: string; end_time?: string; auto_confirm?: boolean; is_active?: boolean }) => {
      const { data, error } = await (supabase as any)
        .from("chat_availability_slots")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat_availability_slots"] });
      qc.invalidateQueries({ queryKey: ["chat_available_times"] });
      qc.invalidateQueries({ queryKey: ["chat_unavailable_dates"] });
    },
  });
}

export function useDeleteChatSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("chat_availability_slots")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat_availability_slots"] });
      qc.invalidateQueries({ queryKey: ["chat_available_times"] });
      qc.invalidateQueries({ queryKey: ["chat_unavailable_dates"] });
    },
  });
}

export function useChatAvailableTimes(unitId?: string, date?: string, options?: { excludeInterviewId?: string }) {
  return useQuery({
    queryKey: ["chat_available_times", unitId, date, options?.excludeInterviewId || null],
    enabled: !!unitId && !!date,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_chat_available_times", {
        _unit_id: unitId!,
        _date: date!,
        _bypass_lead_time: false,
        _exclude_interview_id: options?.excludeInterviewId || null,
      });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        slotId: row.slot_id,
        startTime: row.start_time,
        endTime: row.end_time,
      }));
    },
  });
}

export function useChatUnavailableDates(unitId?: string, daysAhead: number = 90, options?: { excludeInterviewId?: string }) {
  return useQuery({
    queryKey: ["chat_unavailable_dates", unitId, daysAhead, options?.excludeInterviewId || null],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_chat_unavailable_dates", {
        _unit_id: unitId!,
        _days_ahead: daysAhead,
        _bypass_lead_time: false,
        _exclude_interview_id: options?.excludeInterviewId || null,
      });
      if (error) throw error;
      const set = new Set<string>();
      (data || []).forEach((row: any) => { if (row?.unavailable_date) set.add(row.unavailable_date); });
      return set;
    },
    staleTime: 30_000,
  });
}

/**
 * Agenda um Bate-Papo Pós-Teste. Grava em `interviews` com purpose='bate_papo'
 * e usa `chat_availability_slots` para descobrir se o horário auto-confirma.
 * A criação da sala LiveKit é herdada do fluxo existente de entrevistas online
 * (modality='online' + meeting_provider='livekit').
 */
export function useScheduleChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      application_id: string;
      candidate_id: string;
      unit_id: string;
      slot_id: string;
      scheduled_date: string;
      scheduled_time: string;
    }) => {
      // Auto-confirm vem exclusivamente da tabela de slots do bate-papo.
      const { data: slotRow } = await (supabase as any)
        .from("chat_availability_slots")
        .select("auto_confirm")
        .eq("id", input.slot_id)
        .maybeSingle();
      const initialStatus = slotRow?.auto_confirm ? "confirmed" : "pending_approval";

      // Cancela bate-papos ativos anteriores para esta application (reagendamento).
      const { data: active } = await supabase
        .from("interviews")
        .select("id")
        .eq("application_id", input.application_id)
        .eq("purpose", "bate_papo")
        .in("status", ["confirmed", "reschedule_requested", "pending_approval"]);
      if (active && active.length > 0) {
        for (const row of active) {
          await supabase.from("interviews").update({ status: "rescheduled" } as any).eq("id", row.id);
        }
      }

      const { data, error } = await supabase
        .from("interviews")
        .insert({
          application_id: input.application_id,
          candidate_id: input.candidate_id,
          unit_id: input.unit_id,
          slot_id: null, // slot_id pertence a availability_slots (entrevista); mantemos NULL para não misturar
          scheduled_date: input.scheduled_date,
          scheduled_time: input.scheduled_time,
          modality: "online",
          purpose: "bate_papo",
          status: initialStatus,
          meeting_provider: "livekit",
          meeting_link: null,
        } as any)
        .select()
        .single();
      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("compromisso") || (error as any).code === "23505") {
          throw new Error("Este horário já foi reservado. Escolha outro.");
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat_available_times"] });
      qc.invalidateQueries({ queryKey: ["chat_unavailable_dates"] });
      qc.invalidateQueries({ queryKey: ["my_interviews"] });
      qc.invalidateQueries({ queryKey: ["post_test_chat_candidates"] });
    },
  });
}
