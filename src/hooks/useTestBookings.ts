import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type UnitTestModality = "presencial" | "online" | "ambos";

export interface AvailableTestTime {
  slotId: string;
  startTime: string; // HH:MM:SS
  endTime: string;
  modality: string;
}

/** Lê configuração de teste de uma unidade (enabled + modality). */
export function useUnitTestConfig(unitId?: string) {
  return useQuery({
    queryKey: ["unit_test_config", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("unit_test_config")
        .select("unit_id, enabled, modality")
        .eq("unit_id", unitId)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as
        | { unit_id: string; enabled: boolean; modality: UnitTestModality }
        | null;
    },
  });
}

/** Horários livres do teste presencial em uma unidade/data. */
export function useAvailableTestTimes(unitId?: string, ymdDate?: string) {
  return useQuery({
    queryKey: ["available_test_times", unitId, ymdDate],
    enabled: !!unitId && !!ymdDate,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "get_available_test_times",
        { p_unit_id: unitId, p_date: ymdDate },
      );
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        slotId: r.slot_id,
        startTime: r.start_time,
        endTime: r.end_time,
        modality: r.modality,
      })) as AvailableTestTime[];
    },
  });
}

/**
 * Dias da semana com slots de TESTE ativos (0=dom..6=sáb) + datas bloqueadas.
 * Usado para desabilitar dias não configurados no calendário do candidato.
 */
export function useTestSchedulingAvailability(unitId?: string) {
  return useQuery({
    queryKey: ["test_scheduling_availability", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const [{ data: slots }, { data: blocks }] = await Promise.all([
        (supabase as any)
          .from("availability_slots")
          .select("day_of_week")
          .eq("unit_id", unitId)
          .eq("slot_type", "test")
          .eq("is_active", true)
          .in("modality", ["presencial", "ambos"]),
        (supabase as any)
          .from("blocked_dates")
          .select("date, unit_id")
          .or(`unit_id.eq.${unitId},unit_id.is.null`),
      ]);
      const weekdays = new Set<number>(
        ((slots || []) as any[]).map((s) => Number(s.day_of_week)),
      );
      const blockedDates = new Set<string>(
        ((blocks || []) as any[]).map((b) => b.date as string),
      );
      return { weekdays, blockedDates };
    },
  });
}

interface CreateBookingArgs {
  /** Opcional: nulo no fluxo de pipeline (teste pós-entrevista sem módulo de Testes) */
  testAssignmentId?: string | null;
  applicationId: string;
  unitId: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM:SS
  endTime?: string;
}

/** Cria booking de teste presencial. Bloqueia o slot via índice único. */
export function useCreateTestBooking() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: CreateBookingArgs) => {
      if (!user?.id) throw new Error("Usuário não autenticado");

      const { data, error } = await (supabase as any)
        .from("test_bookings")
        .insert({
          test_assignment_id: args.testAssignmentId || null,
          application_id: args.applicationId,
          candidate_id: user.id,
          unit_id: args.unitId,
          scheduled_date: args.scheduledDate,
          scheduled_time: args.scheduledTime,
          end_time: args.endTime || null,
          modality: "presencial",
          status: "agendado",
        })
        .select("id")
        .maybeSingle();

      if (error) {
        if (error.code === "23505") {
          throw new Error("Esse horário acabou de ser preenchido. Escolha outro.");
        }
        throw error;
      }

      // Atualiza assignment com booking_id + modalidade escolhida (fluxo legado)
      if (args.testAssignmentId) {
        await (supabase as any)
          .from("test_assignments")
          .update({
            modality_chosen: "presencial",
            booking_id: data?.id,
          })
          .eq("id", args.testAssignmentId);
      }

      return data?.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["available_test_times"] });
      qc.invalidateQueries({ queryKey: ["my_test_assignments"] });
      qc.invalidateQueries({ queryKey: ["test_bookings"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
    },
  });
}

interface RescheduleTestBookingArgs {
  bookingId: string;
  applicationId: string;
  candidateId: string;
  oldDate: string;
  oldTime: string;
  newDate: string; // YYYY-MM-DD
  newTime: string; // HH:MM:SS
  endTime?: string;
  reason?: string;
}

/**
 * Reagenda um teste presencial (ação do admin/recrutador).
 * Regra: apenas 1 reagendamento por candidato. O histórico (data anterior,
 * nova data, usuário responsável, timestamp) é gravado em `calendar_logs`
 * — mesmo padrão do reagendamento de entrevista, sem alterar schema.
 */
export function useRescheduleTestBooking() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: RescheduleTestBookingArgs) => {
      if (!user?.id) throw new Error("Usuário não autenticado");

      // Limite: 1 reagendamento por candidato.
      const { count } = await (supabase as any)
        .from("calendar_logs")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "test_reschedule")
        .eq("context->>candidate_id", args.candidateId);
      if ((count || 0) >= 1) {
        throw new Error("Limite de 1 reagendamento de teste atingido para este candidato.");
      }

      const { error } = await (supabase as any)
        .from("test_bookings")
        .update({
          scheduled_date: args.newDate,
          scheduled_time: args.newTime,
          end_time: args.endTime || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.bookingId);
      if (error) {
        if (error.code === "23505") {
          throw new Error("Esse horário acabou de ser preenchido. Escolha outro.");
        }
        throw error;
      }

      // Histórico (não apaga registros anteriores).
      await (supabase as any).from("calendar_logs").insert({
        event_type: "test_reschedule",
        user_id: user.id,
        context: {
          test_booking_id: args.bookingId,
          application_id: args.applicationId,
          candidate_id: args.candidateId,
          old_date: args.oldDate,
          old_time: args.oldTime,
          new_date: args.newDate,
          new_time: args.newTime,
          reschedule_number: 1,
          reason: args.reason || null,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_bookings_list"] });
      qc.invalidateQueries({ queryKey: ["test_bookings"] });
      qc.invalidateQueries({ queryKey: ["available_test_times"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["test_reschedule_used"] });
    },
  });
}

/** Marca assignment como online (candidato escolheu online quando modalidade=ambos). */
export function useChooseOnlineTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await (supabase as any)
        .from("test_assignments")
        .update({ modality_chosen: "online" })
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my_test_assignments"] });
    },
  });
}

/** Lista bookings presenciais agendados de uma unidade (admin). */
export function useUnitTestBookings(unitId?: string) {
  return useQuery({
    queryKey: ["test_bookings", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("test_bookings")
        .select(
          "id, scheduled_date, scheduled_time, end_time, status, modality, candidate_id, application_id, applications(unit_jobs(jobs(title)))",
        )
        .eq("unit_id", unitId)
        .eq("status", "agendado")
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

// ============================================================
// LISTAGEM / STATS para aba "Testes Agendados" em /admin/agendamento
// (somente leitura; não toca em nada do fluxo de booking existente)
// ============================================================

export interface TestBookingsListFilters {
  unitId?: string;
  unitIds?: string[];
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Lista paginada de candidatos que estão (ou já passaram) pela fase
 * "Teste pós-entrevista" do pipeline. Inclui online e presencial.
 * Fonte: applications.current_phase OR application_journey_events.phase_id
 * apontando para pipeline_phases.name = 'Teste pós-entrevista'.
 * Enriquece com test_bookings (presencial) e test_assignments (online) quando existirem.
 */
export function useTestBookingsList(filters?: TestBookingsListFilters, pageSize = 30) {
  return useInfiniteQuery({
    queryKey: ["test_bookings_list", filters, pageSize],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      // Fonte principal: marcação da liberação do pós-entrevista.
      // Fallback: respostas já gravadas nessa fase, para manter visíveis
      // candidaturas antigas/resetadas que executaram o teste mesmo sem o
      // booleano preenchido.
      const { data: answeredApps, error: answeredError } = await (supabase as any)
        .from("step_responses")
        .select(
          "application_id, pipeline_steps!inner(phase_id, pipeline_phases!inner(phase_kind))",
        )
        .eq("pipeline_steps.pipeline_phases.phase_kind", "avaliacao_pos_entrevista")
        .not("application_id", "is", null)
        .limit(1000);

      if (answeredError) throw answeredError;

      const answeredApplicationIds = Array.from(
        new Set(((answeredApps || []) as any[]).map((r) => r.application_id).filter(Boolean)),
      );

      const sourceFilters = ["post_interview_test_assigned.eq.true"];
      if (answeredApplicationIds.length > 0) {
        sourceFilters.push(`id.in.(${answeredApplicationIds.join(",")})`);
      }

      let q = (supabase as any)
        .from("applications")
        .select(
          "id, candidate_id, status, current_phase, created_at, " +
            "unit_jobs!inner(unit_id, jobs(id, title), units(id, name))",
        )
        .or(sourceFilters.join(","));

      if (filters?.unitId) q = q.eq("unit_jobs.unit_id", filters.unitId);
      else if (filters?.unitIds && filters.unitIds.length > 0) {
        q = q.in("unit_jobs.unit_id", filters.unitIds);
      }

      const from = pageParam * pageSize;
      const to = from + pageSize - 1;
      q = q.order("created_at", { ascending: false }).range(from, to);

      const { data: apps, error } = await q;
      if (error) throw error;
      const baseRows = (apps || []) as any[];
      if (baseRows.length === 0) return { rows: [], nextPage: null };

      const appIds = baseRows.map((a) => a.id);
      const candidateIds = Array.from(new Set(baseRows.map((a) => a.candidate_id).filter(Boolean)));

      // 4. Enriquecimento paralelo: candidatos, bookings, assignments,
      //    e step_responses do pipeline (fase avaliacao_pos_entrevista)
      //    — usado quando o candidato executa o teste pelo wizard do
      //    pipeline e não há test_assignments/test_bookings.
      const [{ data: cands }, { data: bookings }, { data: assigns }, { data: stepResps }, { data: feedbacks }] =
        await Promise.all([
          candidateIds.length > 0
            ? (supabase as any).from("candidates").select("id, full_name").in("id", candidateIds)
            : Promise.resolve({ data: [] }),
          (supabase as any)
            .from("test_bookings")
            .select("id, application_id, scheduled_date, scheduled_time, end_time, status, modality, unit_id")
            .in("application_id", appIds)
            .order("scheduled_date", { ascending: false }),
          (supabase as any)
            .from("test_assignments")
            .select("id, application_id, status, modality_chosen, score, completed_at, started_at, booking_id")
            .in("application_id", appIds)
            .eq("post_interview", true)
            .order("created_at", { ascending: false }),
          (supabase as any)
            .from("step_responses")
            .select(
              "application_id, score, evaluated_at, created_at, " +
                "pipeline_steps!inner(phase_id, pipeline_phases!inner(phase_kind))",
            )
            .in("application_id", appIds)
            .eq("pipeline_steps.pipeline_phases.phase_kind", "avaliacao_pos_entrevista")
            .order("created_at", { ascending: false }),
          // Avaliação PRESENCIAL efetivamente registrada (test_feedback) — sinal
          // correto de "já avaliado" para o presencial (diferente do online, que
          // apenas grava step_response).
          (supabase as any)
            .from("test_feedback")
            .select("application_id, decision, id")
            .in("application_id", appIds),
        ]);

      const nameMap: Record<string, string> = Object.fromEntries(
        (cands || []).map((c: any) => [c.id, c.full_name]),
      );
      // Prefer bookings that ainda estão vivos (não canceladas / não no-show).
      // Um booking cancelado antigo NÃO deve poluir modalidade/data/status
      // de uma candidatura reativada que refez o teste depois.
      const bookingByApp: Record<string, any> = {};
      const isDeadBookingStatus = (s?: string | null) =>
        s === "cancelado" || s === "no_show";
      (bookings || []).forEach((b: any) => {
        const cur = bookingByApp[b.application_id];
        if (!cur) {
          bookingByApp[b.application_id] = b;
        } else if (isDeadBookingStatus(cur.status) && !isDeadBookingStatus(b.status)) {
          bookingByApp[b.application_id] = b;
        }
      });
      const assignByApp: Record<string, any> = {};
      (assigns || []).forEach((a: any) => {
        if (!assignByApp[a.application_id]) assignByApp[a.application_id] = a;
      });
      // Agrega step_responses por candidatura (último e média de score)
      const stepByApp: Record<string, { latest: any; sumScore: number; count: number }> = {};
      (stepResps || []).forEach((r: any) => {
        const cur = stepByApp[r.application_id];
        if (!cur) {
          stepByApp[r.application_id] = {
            latest: r,
            sumScore: r.score != null ? Number(r.score) : 0,
            count: r.score != null ? 1 : 0,
          };
        } else if (r.score != null) {
          cur.sumScore += Number(r.score);
          cur.count += 1;
        }
      });

      // Avaliação presencial registrada por candidatura (test_feedback).
      const feedbackByApp: Record<string, any> = {};
      (feedbacks || []).forEach((f: any) => {
        if (f.application_id && !feedbackByApp[f.application_id]) feedbackByApp[f.application_id] = f;
      });

      // 5. Mapear para o shape esperado pelo componente
      const rows = baseRows.map((app) => {
        const booking = bookingByApp[app.id] || null;
        const assign = assignByApp[app.id] || null;
        const step = stepByApp[app.id] || null;
        const bookingAlive = booking && !isDeadBookingStatus(booking.status);
        // Se o teste foi executado pelo wizard (step_response) e o único
        // booking é cancelado/no-show, tratamos a candidatura como "online"
        // e escondemos o booking morto do UI.
        const effectiveBooking = bookingAlive ? booking : (step ? null : booking);
        // Fallback pipeline: teste executado in-app => modalidade online
        const modality_chosen =
          assign?.modality_chosen ||
          (effectiveBooking?.modality === "presencial" ? "presencial" : null) ||
          (step ? "online" : null);
        // completed_at: assignment > step_response.evaluated_at/created_at
        const completed_at =
          assign?.completed_at ||
          step?.latest?.evaluated_at ||
          step?.latest?.created_at ||
          null;
        // score: assignment > média das step_responses da fase
        const score =
          assign?.score != null
            ? assign.score
            : step && step.count > 0
              ? step.sumScore / step.count
              : null;
        // status: assignment > "avaliado" quando step com score > status da app
        const status =
          assign?.status ||
          (step && step.count > 0 ? "avaliado" : null) ||
          app.status;
        return {
          id: app.id,
          candidate_id: app.candidate_id,
          application_id: app.id,
          candidate_name: nameMap[app.candidate_id] || null,
          modality_chosen,
          status,
          score,
          completed_at,
          started_at: assign?.started_at || null,
          created_at: app.created_at,
          booking_id: effectiveBooking?.id || assign?.booking_id || null,
          test_bookings: effectiveBooking,
          presencial_evaluated: !!feedbackByApp[app.id],
          applications: {
            unit_jobs: {
              unit_id: app.unit_jobs?.unit_id,
              jobs: app.unit_jobs?.jobs,
              units: app.unit_jobs?.units,
            },
          },
        };
      });

      // 6. Filtro de status (unificado) em memória
      let filtered = rows;
      if (filters?.status && filters.status !== "all") {
        const statusMap: Record<string, string[]> = {
          aguardando: ["pendente", "released", "aguardando_agendamento", "em_andamento"],
          em_andamento: ["em_andamento", "started"],
          concluido: ["concluido"],
          avaliado: ["avaliado", "aprovado"],
          cancelado: ["cancelado", "desistente", "desligado"],
          no_show: ["no_show"],
        };
        const allowed = statusMap[filters.status];
        if (allowed) {
          filtered = filtered.filter((r) => {
            const k = r.test_bookings?.status === "no_show" || r.test_bookings?.status === "cancelado"
              ? r.test_bookings.status
              : r.status;
            return allowed.includes(k);
          });
        }
      }

      // 7. Filtro de data
      const inRange = (r: any) => {
        const eff = r.test_bookings?.scheduled_date
          || (r.completed_at ? r.completed_at.slice(0, 10) : null);
        if (filters?.dateFrom && (!eff || eff < filters.dateFrom)) return false;
        if (filters?.dateTo && (!eff || eff > filters.dateTo)) return false;
        return true;
      };
      filtered = filtered.filter(inRange);

      return { rows: filtered, nextPage: baseRows.length < pageSize ? null : pageParam + 1 };
    },
    getNextPageParam: (last: any) => last.nextPage,
  });
}


export function useTestBookingsStats(scope?: { unitId?: string; unitIds?: string[] }) {
  return useQuery({
    queryKey: ["test_bookings_stats", scope],
    queryFn: async () => {
      const base = () => {
        let q = (supabase as any).from("test_bookings").select("id", { count: "exact", head: true });
        if (scope?.unitId) q = q.eq("unit_id", scope.unitId);
        else if (scope?.unitIds && scope.unitIds.length > 0) q = q.in("unit_id", scope.unitIds);
        return q;
      };

      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      const [{ count: total }, { count: todayCount }, { count: noShow }] = await Promise.all([
        base(),
        base().eq("scheduled_date", ymd),
        base().eq("status", "no_show"),
      ]);

      return { total: total || 0, today: todayCount || 0, noShow: noShow || 0 };
    },
  });
}

