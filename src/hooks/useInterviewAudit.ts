import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

export interface UnitAuditMetrics {
  unitId: string;
  unitName: string;
  city: string | null;
  state: string | null;
  total: number;
  concluidas: number;
  noShows: number;
  canceladas: number;
  attendanceRate: number;
  noShowRate: number;
  hasAlert: boolean;
}

export interface AuditSummary {
  totalInterviews: number;
  attendanceRate: number;
  noShowRate: number;
  totalCancelled: number;
  perUnit: UnitAuditMetrics[];
}

export interface CandidateNoShowMetrics {
  candidateId: string;
  candidateName: string;
  noShows: number;
  total: number;
  noShowRate: number;
}

export interface RescheduleMetrics {
  avgRescheduleDays: number;
  totalReschedules: number;
}

export function useCandidateNoShowMetrics(filters?: { dateFrom?: string; dateTo?: string }) {
  return useQuery({
    queryKey: ["candidate_no_show_metrics", filters],
    queryFn: async (): Promise<CandidateNoShowMetrics[]> => {
      let q = supabase
        .from("interviews")
        .select("id, status, candidate_id, profiles(full_name)");
      if (filters?.dateFrom) q = q.gte("scheduled_date", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("scheduled_date", filters.dateTo);
      const { data, error } = await q;
      if (error) throw error;

      const map = new Map<string, { name: string; total: number; noShows: number }>();
      for (const i of (data || [])) {
        const cid = i.candidate_id;
        if (!map.has(cid)) map.set(cid, { name: (i.profiles as any)?.full_name || "—", total: 0, noShows: 0 });
        const m = map.get(cid)!;
        m.total++;
        if (i.status === "no_show") m.noShows++;
      }

      return Array.from(map.entries())
        .filter(([, m]) => m.noShows > 0)
        .map(([candidateId, m]) => ({
          candidateId,
          candidateName: m.name,
          noShows: m.noShows,
          total: m.total,
          noShowRate: Math.round((m.noShows / m.total) * 1000) / 10,
        }))
        .sort((a, b) => b.noShowRate - a.noShowRate);
    },
  });
}

export function useRescheduleMetrics(filters?: { dateFrom?: string; dateTo?: string }) {
  return useQuery({
    queryKey: ["reschedule_metrics", filters],
    queryFn: async (): Promise<RescheduleMetrics> => {
      let q = supabase
        .from("calendar_logs")
        .select("created_at, context")
        .eq("event_type", "reschedule");
      if (filters?.dateFrom) q = q.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("created_at", filters.dateTo);
      const { data, error } = await q;
      if (error) throw error;

      const logs = data || [];
      if (logs.length === 0) return { avgRescheduleDays: 0, totalReschedules: 0 };

      // Calculate average time between old_date and created_at (when reschedule happened)
      let totalDays = 0;
      let count = 0;
      for (const log of logs) {
        const ctx = log.context as any;
        if (ctx?.old_date) {
          const oldDate = new Date(ctx.old_date + "T12:00:00");
          const rescheduleDate = new Date(log.created_at);
          const diffDays = Math.abs(rescheduleDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24);
          totalDays += diffDays;
          count++;
        }
      }

      return {
        avgRescheduleDays: count > 0 ? Math.round((totalDays / count) * 10) / 10 : 0,
        totalReschedules: logs.length,
      };
    },
  });
}

export function useInterviewMetrics(filters?: { dateFrom?: string; dateTo?: string; unitIds?: string[] }) {
  const { data: settings } = useGlobalSettings("interview_audit");

  const noShowThreshold = settings?.find(s => s.key === "no_show_threshold")?.value ?? 2;
  const thresholdNum = typeof noShowThreshold === "number" ? noShowThreshold : Number(noShowThreshold) || 2;

  return useQuery({
    queryKey: ["interview_audit_metrics", filters, thresholdNum],
    queryFn: async (): Promise<AuditSummary> => {
      // Fetch all interviews with unit info
      let q = supabase
        .from("interviews")
        .select("id, status, unit_id, scheduled_date, units(id, name, city, state)");

      if (filters?.dateFrom) q = q.gte("scheduled_date", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("scheduled_date", filters.dateTo);
      if (filters?.unitIds && filters.unitIds.length > 0) q = q.in("unit_id", filters.unitIds);

      const { data, error } = await q;
      if (error) throw error;

      const interviews = data || [];

      // Group by unit
      const unitMap = new Map<string, {
        unitName: string;
        city: string | null;
        state: string | null;
        total: number;
        concluidas: number;
        noShows: number;
        canceladas: number;
      }>();

      for (const i of interviews) {
        const uid = i.unit_id;
        const unit = i.units as any;
        if (!unitMap.has(uid)) {
          unitMap.set(uid, {
            unitName: unit?.name || "—",
            city: unit?.city || null,
            state: unit?.state || null,
            total: 0,
            concluidas: 0,
            noShows: 0,
            canceladas: 0,
          });
        }
        const m = unitMap.get(uid)!;
        m.total++;
        if (i.status === "completed") m.concluidas++;
        else if (i.status === "no_show") m.noShows++;
        else if (i.status === "cancelled") m.canceladas++;
      }

      // Calculate per-unit metrics
      const perUnit: UnitAuditMetrics[] = [];
      let globalTotal = 0;
      let globalConcluidas = 0;
      let globalNoShows = 0;
      let globalCanceladas = 0;

      for (const [unitId, m] of unitMap) {
        const evaluable = m.total - m.canceladas;
        const attendanceRate = evaluable > 0 ? (m.concluidas / evaluable) * 100 : 0;
        const noShowRate = evaluable > 0 ? (m.noShows / evaluable) * 100 : 0;

        perUnit.push({
          unitId,
          unitName: m.unitName,
          city: m.city,
          state: m.state,
          total: m.total,
          concluidas: m.concluidas,
          noShows: m.noShows,
          canceladas: m.canceladas,
          attendanceRate: Math.round(attendanceRate * 10) / 10,
          noShowRate: Math.round(noShowRate * 10) / 10,
          hasAlert: m.noShows >= thresholdNum,
        });

        globalTotal += m.total;
        globalConcluidas += m.concluidas;
        globalNoShows += m.noShows;
        globalCanceladas += m.canceladas;
      }

      const globalEvaluable = globalTotal - globalCanceladas;
      const attendanceRate = globalEvaluable > 0 ? (globalConcluidas / globalEvaluable) * 100 : 0;
      const noShowRate = globalEvaluable > 0 ? (globalNoShows / globalEvaluable) * 100 : 0;

      // Sort by no-show rate descending (worst first)
      perUnit.sort((a, b) => b.noShowRate - a.noShowRate);

      return {
        totalInterviews: globalTotal,
        attendanceRate: Math.round(attendanceRate * 10) / 10,
        noShowRate: Math.round(noShowRate * 10) / 10,
        totalCancelled: globalCanceladas,
        perUnit,
      };
    },
  });
}
