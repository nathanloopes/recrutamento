import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

export interface HiringAuditMetrics {
  total: number;
  open: number;
  completed: number;
  completionRate: number;
  avgCompletionDays: number;
  avgValidationDays: number;
  criticalCount: number;
  unitMetrics: UnitHiringMetric[];
}

export interface UnitHiringMetric {
  unitId: string;
  unitName: string;
  total: number;
  completed: number;
  open: number;
  completionRate: number;
  avgCompletionDays: number;
  avgValidationDays: number;
  delayedCount: number;
  criticalCount: number;
  rejectionCount: number;
  hasAlert: boolean;
}

export function useHiringAuditMetrics() {
  const { data: auditSettings } = useGlobalSettings("hiring_audit");

  const alertDays = Number(auditSettings?.find((s) => s.key === "auto_alert_after_days")?.value) || 5;
  const criticalDays = Number(auditSettings?.find((s) => s.key === "critical_threshold_days")?.value) || 14;

  return useQuery({
    queryKey: ["hiring_audit_metrics", alertDays, criticalDays],
    queryFn: async (): Promise<HiringAuditMetrics> => {
      const [{ data: requests, error }, { data: uploads, error: upErr }, { data: rejLogs, error: logErr }] = await Promise.all([
        supabase
          .from("document_requests")
          .select("*, units:unit_id(name)")
          .order("created_at", { ascending: false }),
        supabase
          .from("document_uploads")
          .select("request_id, uploaded_at, validated_at, status")
          .not("validated_at", "is", null),
        supabase
          .from("document_logs")
          .select("request_id, created_at")
          .eq("event", "rejeitado"),
      ]);

      if (error) throw error;
      const all = requests || [];

      const now = Date.now();
      const dayMs = 86400000;
      const getOverdueDays = (request: any): number | null => {
        const rawDeadline = request.deadline_date;
        if (!rawDeadline) return null;
        const deadline = new Date(rawDeadline).getTime();
        if (!Number.isFinite(deadline)) return null;
        return (now - deadline) / dayMs;
      };

      const open = all.filter((r) => r.status === "open");
      const completed = all.filter((r) => r.status === "completed");

      // Avg completion time
      const completionTimes = completed
        .filter((r) => r.completed_at)
        .map((r) => (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()) / dayMs);
      const avgCompletionDays = completionTimes.length > 0
        ? Math.round((completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length) * 10) / 10
        : 0;

      // Avg validation time (upload → validated)
      const validationTimes = (uploads || [])
        .filter((u: any) => u.uploaded_at && u.validated_at)
        .map((u: any) => (new Date(u.validated_at).getTime() - new Date(u.uploaded_at).getTime()) / dayMs);
      const avgValidationDays = validationTimes.length > 0
        ? Math.round((validationTimes.reduce((a: number, b: number) => a + b, 0) / validationTimes.length) * 10) / 10
        : 0;

      // Rejection counts by request_id → unit
      const rejByRequest = new Map<string, number>();
      for (const l of (rejLogs || []) as any[]) {
        rejByRequest.set(l.request_id, (rejByRequest.get(l.request_id) || 0) + 1);
      }

      // Validation times by request_id
      const valTimesByRequest = new Map<string, number[]>();
      for (const u of (uploads || []) as any[]) {
        if (!u.uploaded_at || !u.validated_at) continue;
        const t = (new Date(u.validated_at).getTime() - new Date(u.uploaded_at).getTime()) / dayMs;
        if (!valTimesByRequest.has(u.request_id)) valTimesByRequest.set(u.request_id, []);
        valTimesByRequest.get(u.request_id)!.push(t);
      }

      // Critical count
      const criticalCount = open.filter((r) => {
        const overdueDays = getOverdueDays(r);
        return overdueDays !== null
          ? overdueDays > criticalDays
          : (now - new Date(r.created_at).getTime()) / dayMs > criticalDays;
      }).length;

      // Per-unit metrics
      const unitMap = new Map<string, { unitName: string; items: typeof all }>();
      for (const r of all) {
        const uid = r.unit_id;
        const uName = (r as any).units?.name || "Sem unidade";
        if (!unitMap.has(uid)) unitMap.set(uid, { unitName: uName, items: [] });
        unitMap.get(uid)!.items.push(r);
      }

      const unitMetrics: UnitHiringMetric[] = Array.from(unitMap.entries()).map(([unitId, { unitName, items }]) => {
        const uCompleted = items.filter((i) => i.status === "completed");
        const uOpen = items.filter((i) => i.status === "open");
        const uDelayed = uOpen.filter((i) => {
          const overdueDays = getOverdueDays(i);
          return overdueDays !== null
            ? overdueDays > 0
            : (now - new Date(i.created_at).getTime()) / dayMs > alertDays;
        });
        const uCritical = uOpen.filter((i) => {
          const overdueDays = getOverdueDays(i);
          return overdueDays !== null
            ? overdueDays > criticalDays
            : (now - new Date(i.created_at).getTime()) / dayMs > criticalDays;
        });

        const uTimes = uCompleted
          .filter((i) => i.completed_at)
          .map((i) => (new Date(i.completed_at!).getTime() - new Date(i.created_at).getTime()) / dayMs);
        const uAvg = uTimes.length > 0
          ? Math.round((uTimes.reduce((a, b) => a + b, 0) / uTimes.length) * 10) / 10
          : 0;

        // Avg validation per unit
        const uValTimes: number[] = [];
        for (const i of items) {
          const vt = valTimesByRequest.get(i.id);
          if (vt) uValTimes.push(...vt);
        }
        const uAvgVal = uValTimes.length > 0
          ? Math.round((uValTimes.reduce((a, b) => a + b, 0) / uValTimes.length) * 10) / 10
          : 0;

        // Rejection count per unit
        let uRejCount = 0;
        for (const i of items) {
          uRejCount += rejByRequest.get(i.id) || 0;
        }

        return {
          unitId,
          unitName,
          total: items.length,
          completed: uCompleted.length,
          open: uOpen.length,
          completionRate: items.length > 0 ? Math.round((uCompleted.length / items.length) * 100) : 0,
          avgCompletionDays: uAvg,
          avgValidationDays: uAvgVal,
          delayedCount: uDelayed.length,
          criticalCount: uCritical.length,
          rejectionCount: uRejCount,
          hasAlert: uDelayed.length > items.length * 0.5,
        };
      });

      return {
        total: all.length,
        open: open.length,
        completed: completed.length,
        completionRate: all.length > 0 ? Math.round((completed.length / all.length) * 100) : 0,
        avgCompletionDays,
        avgValidationDays,
        criticalCount,
        unitMetrics: unitMetrics.sort((a, b) => b.total - a.total),
      };
    },
  });
}
