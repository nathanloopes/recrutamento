import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useAttendanceRate() {
  const { hasRole, unitIds } = useAuth();
  const isGlobalAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["attendance_rate", isGlobalAdmin, unitIds],
    queryFn: async () => {
      if (!isGlobalAdmin && unitIds.length === 0) {
        return { rate: null, total: 0, attended: 0 };
      }

      let q = supabase
        .from("attendance_logs")
        .select("attendance_status, unit_id");

      if (!isGlobalAdmin && unitIds.length > 0) {
        q = q.in("unit_id", unitIds);
      }

      const { data } = await q;
      if (!data || data.length === 0) return { rate: null, total: 0, attended: 0 };

      const total = data.length;
      const attended = data.filter((l: any) => l.attendance_status === "compareceu" || l.attendance_status === "atraso").length;
      const rate = total > 0 ? Math.round((attended / total) * 100) : 0;

      return { rate, total, attended };
    },
  });
}

export function usePendingDocsWithWaitTime() {
  const { hasRole, unitIds } = useAuth();
  const isGlobalAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["pending_docs_wait_time", isGlobalAdmin, unitIds],
    queryFn: async () => {
      if (!isGlobalAdmin && unitIds.length === 0) {
        return { total: 0, overdue48h: 0, items: [] };
      }

      let q = supabase
        .from("document_requests")
        .select("id, created_at, candidate_id, profiles!document_requests_candidate_id_fkey(full_name)")
        .eq("status", "open");

      if (!isGlobalAdmin && unitIds.length > 0) {
        q = q.in("unit_id", unitIds);
      }

      const { data } = await q;
      if (!data || data.length === 0) return { total: 0, overdue48h: 0, items: [] };

      const now = Date.now();
      const items = data.map((d: any) => {
        const hoursWaiting = Math.round((now - new Date(d.created_at).getTime()) / (1000 * 60 * 60));
        return {
          id: d.id,
          candidateName: d.profiles?.full_name || "Candidato",
          hoursWaiting,
        };
      });

      const overdue48h = items.filter((i) => i.hoursWaiting >= 48).length;

      return { total: data.length, overdue48h, items: items.sort((a, b) => b.hoursWaiting - a.hoursWaiting) };
    },
  });
}
