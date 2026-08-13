import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PhaseCount {
  phase: string;
  count: number;
  percentage: number;
}

export interface ReasonCount {
  reason: string;
  count: number;
}

export interface UnitCount {
  unitName: string;
  count: number;
}

export interface FeedbackEntry {
  notes: string;
  decision: string;
  createdAt: string;
}

export function useWithdrawalAnalysis() {
  return useQuery({
    queryKey: ["withdrawal_analysis"],
    queryFn: async () => {
      // 1. Get all withdrawn applications
      const { data: apps } = await supabase
        .from("applications")
        .select("id, withdrawal_reason, unit_job_id")
        .eq("status", "desistente");

      if (!apps?.length) return { byPhase: [], reasons: [], byUnit: [], total: 0 };

      const appIds = apps.map((a) => a.id);
      const unitJobIds = [...new Set(apps.map((a) => a.unit_job_id))];

      // 2. Get last progress log per application to find phase of withdrawal
      const { data: logs } = await supabase
        .from("candidate_progress_logs")
        .select("application_id, phase, created_at")
        .in("application_id", appIds)
        .order("created_at", { ascending: false });

      // Group: last phase per application
      const lastPhase: Record<string, string> = {};
      (logs || []).forEach((l) => {
        if (!lastPhase[l.application_id]) lastPhase[l.application_id] = l.phase;
      });

      // By phase
      const phaseCounts: Record<string, number> = {};
      apps.forEach((a) => {
        const phase = lastPhase[a.id] || "Sem registro";
        phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
      });
      const byPhase: PhaseCount[] = Object.entries(phaseCounts)
        .map(([phase, count]) => ({ phase, count, percentage: Math.round((count / apps.length) * 100) }))
        .sort((a, b) => b.count - a.count);

      // Reasons
      const reasonCounts: Record<string, number> = {};
      apps.forEach((a) => {
        const reason = a.withdrawal_reason || "Não informado";
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      });
      const reasons: ReasonCount[] = Object.entries(reasonCounts)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);

      // By unit
      const { data: unitJobs } = await supabase
        .from("unit_jobs")
        .select("id, units(name)")
        .in("id", unitJobIds);

      const ujMap: Record<string, string> = {};
      (unitJobs || []).forEach((uj: any) => { ujMap[uj.id] = uj.units?.name || "Desconhecida"; });

      const unitCounts: Record<string, number> = {};
      apps.forEach((a) => {
        const name = ujMap[a.unit_job_id] || "Desconhecida";
        unitCounts[name] = (unitCounts[name] || 0) + 1;
      });
      const byUnit: UnitCount[] = Object.entries(unitCounts)
        .map(([unitName, count]) => ({ unitName, count }))
        .sort((a, b) => b.count - a.count);

      return { byPhase, reasons, byUnit, total: apps.length };
    },
  });
}

export function useRejectionAnalysis() {
  return useQuery({
    queryKey: ["rejection_analysis"],
    queryFn: async () => {
      const { data: apps } = await supabase
        .from("applications")
        .select("id, unit_job_id")
        .in("status", ["standby", "reprovado"]);

      if (!apps?.length) return { byPhase: [], feedbacks: [], byUnit: [], total: 0 };

      const appIds = apps.map((a) => a.id);
      const unitJobIds = [...new Set(apps.map((a) => a.unit_job_id))];

      const { data: logs } = await supabase
        .from("candidate_progress_logs")
        .select("application_id, phase")
        .in("application_id", appIds)
        .in("decision", ["reprovado", "standby"]);

      const phaseCounts: Record<string, number> = {};
      const appsWithPhase = new Set<string>();
      (logs || []).forEach((l) => {
        if (!appsWithPhase.has(l.application_id)) {
          appsWithPhase.add(l.application_id);
          phaseCounts[l.phase] = (phaseCounts[l.phase] || 0) + 1;
        }
      });
      apps.forEach((a) => {
        if (!appsWithPhase.has(a.id)) {
          phaseCounts["Sem registro"] = (phaseCounts["Sem registro"] || 0) + 1;
        }
      });

      const byPhase: PhaseCount[] = Object.entries(phaseCounts)
        .map(([phase, count]) => ({ phase, count, percentage: Math.round((count / apps.length) * 100) }))
        .sort((a, b) => b.count - a.count);

      const { data: interviews } = await supabase
        .from("interviews")
        .select("id, application_id")
        .in("application_id", appIds);

      let feedbacks: FeedbackEntry[] = [];
      if (interviews?.length) {
        const interviewIds = interviews.map((i) => i.id);
        const { data: fbs } = await supabase
          .from("interview_feedback")
          .select("notes, decision, created_at, interview_id")
          .in("interview_id", interviewIds)
          .in("decision", ["reprovado", "rejeitado", "não aprovado"]);

        feedbacks = (fbs || [])
          .filter((f) => f.notes)
          .map((f) => ({ notes: f.notes!, decision: f.decision, createdAt: f.created_at }))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      const { data: unitJobs } = await supabase
        .from("unit_jobs")
        .select("id, units(name)")
        .in("id", unitJobIds);

      const ujMap: Record<string, string> = {};
      (unitJobs || []).forEach((uj: any) => { ujMap[uj.id] = uj.units?.name || "Desconhecida"; });

      const unitCounts: Record<string, number> = {};
      apps.forEach((a) => {
        const name = ujMap[a.unit_job_id] || "Desconhecida";
        unitCounts[name] = (unitCounts[name] || 0) + 1;
      });
      const byUnit: UnitCount[] = Object.entries(unitCounts)
        .map(([unitName, count]) => ({ unitName, count }))
        .sort((a, b) => b.count - a.count);

      return { byPhase, feedbacks, byUnit, total: apps.length };
    },
  });
}

// ─── Unit-specific hooks ───

export function useUnitWithdrawalAnalysis(unitId: string | null) {
  return useQuery({
    queryKey: ["unit_withdrawal_analysis", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      // 1. Get unit_jobs for this unit
      const { data: unitJobs } = await supabase
        .from("unit_jobs")
        .select("id")
        .eq("unit_id", unitId!);

      if (!unitJobs?.length) return { byPhase: [], reasons: [], total: 0 };

      const ujIds = unitJobs.map((uj) => uj.id);

      // 2. Withdrawn applications for this unit
      const { data: apps } = await supabase
        .from("applications")
        .select("id, withdrawal_reason, unit_job_id")
        .eq("status", "desistente")
        .in("unit_job_id", ujIds);

      if (!apps?.length) return { byPhase: [], reasons: [], total: 0 };

      const appIds = apps.map((a) => a.id);

      // 3. Last phase per application
      const { data: logs } = await supabase
        .from("candidate_progress_logs")
        .select("application_id, phase, created_at")
        .in("application_id", appIds)
        .order("created_at", { ascending: false });

      const lastPhase: Record<string, string> = {};
      (logs || []).forEach((l) => {
        if (!lastPhase[l.application_id]) lastPhase[l.application_id] = l.phase;
      });

      const phaseCounts: Record<string, number> = {};
      apps.forEach((a) => {
        const phase = lastPhase[a.id] || "Sem registro";
        phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
      });
      const byPhase: PhaseCount[] = Object.entries(phaseCounts)
        .map(([phase, count]) => ({ phase, count, percentage: Math.round((count / apps.length) * 100) }))
        .sort((a, b) => b.count - a.count);

      const reasonCounts: Record<string, number> = {};
      apps.forEach((a) => {
        const reason = a.withdrawal_reason || "Não informado";
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      });
      const reasons: ReasonCount[] = Object.entries(reasonCounts)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);

      return { byPhase, reasons, total: apps.length };
    },
  });
}

export function useUnitRejectionAnalysis(unitId: string | null) {
  return useQuery({
    queryKey: ["unit_rejection_analysis", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data: unitJobs } = await supabase
        .from("unit_jobs")
        .select("id")
        .eq("unit_id", unitId!);

      if (!unitJobs?.length) return { byPhase: [], feedbacks: [], total: 0 };

      const ujIds = unitJobs.map((uj) => uj.id);

      const { data: apps } = await supabase
        .from("applications")
        .select("id, unit_job_id")
        .in("status", ["standby", "reprovado"])
        .in("unit_job_id", ujIds);

      if (!apps?.length) return { byPhase: [], feedbacks: [], total: 0 };

      const appIds = apps.map((a) => a.id);

      const { data: logs } = await supabase
        .from("candidate_progress_logs")
        .select("application_id, phase")
        .in("application_id", appIds)
        .in("decision", ["reprovado", "standby"]);

      const phaseCounts: Record<string, number> = {};
      const appsWithPhase = new Set<string>();
      (logs || []).forEach((l) => {
        if (!appsWithPhase.has(l.application_id)) {
          appsWithPhase.add(l.application_id);
          phaseCounts[l.phase] = (phaseCounts[l.phase] || 0) + 1;
        }
      });
      apps.forEach((a) => {
        if (!appsWithPhase.has(a.id)) {
          phaseCounts["Sem registro"] = (phaseCounts["Sem registro"] || 0) + 1;
        }
      });

      const byPhase: PhaseCount[] = Object.entries(phaseCounts)
        .map(([phase, count]) => ({ phase, count, percentage: Math.round((count / apps.length) * 100) }))
        .sort((a, b) => b.count - a.count);

      const { data: interviews } = await supabase
        .from("interviews")
        .select("id, application_id")
        .in("application_id", appIds);

      let feedbacks: FeedbackEntry[] = [];
      if (interviews?.length) {
        const interviewIds = interviews.map((i) => i.id);
        const { data: fbs } = await supabase
          .from("interview_feedback")
          .select("notes, decision, created_at, interview_id")
          .in("interview_id", interviewIds)
          .in("decision", ["reprovado", "rejeitado", "não aprovado"]);

        feedbacks = (fbs || [])
          .filter((f) => f.notes)
          .map((f) => ({ notes: f.notes!, decision: f.decision, createdAt: f.created_at }))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      return { byPhase, feedbacks, total: apps.length };
    },
  });
}
