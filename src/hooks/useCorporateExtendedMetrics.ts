import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useCorporateExtendedMetrics() {
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["corporate_extended_metrics", isSuperAdmin, unitIds],
    queryFn: async () => {
      // Admin vê todas as vagas; demais perfis só das suas unidades
      let q = supabase
        .from("unit_jobs")
        .select("id, status, unit_id, created_at");
      if (!isSuperAdmin) {
        if (unitIds.length === 0) {
          return { rejectionRate: 0, avgAdvanceTimeHours: 0, conversionByStatus: {} };
        }
        q = q.in("unit_id", unitIds);
      }
      const { data: unitJobs, error: ujError } = await q;
      if (ujError) throw ujError;

      const jobIds = (unitJobs || []).map((uj: any) => uj.id);
      if (jobIds.length === 0) {
        return { rejectionRate: 0, avgAdvanceTimeHours: 0, conversionByStatus: {} };
      }

      const { data: apps, error: appError } = await supabase
        .from("applications")
        .select("id, status, total_score, created_at, updated_at")
        .in("unit_job_id", jobIds);
      if (appError) throw appError;

      const totalApps = (apps || []).length;
      const rejected = (apps || []).filter((a: any) => a.status === "standby" || a.status === "reprovado").length;
      const rejectionRate = totalApps > 0 ? Math.round((rejected / totalApps) * 100) : 0;

      // Average time from created_at to updated_at (advance time proxy)
      const timeDiffs = (apps || [])
        .filter((a: any) => a.updated_at && a.created_at && a.updated_at !== a.created_at)
        .map((a: any) => new Date(a.updated_at).getTime() - new Date(a.created_at).getTime());
      const avgAdvanceTimeHours = timeDiffs.length > 0
        ? Math.round(timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / (1000 * 60 * 60))
        : 0;

      // Conversion by status
      const conversionByStatus: Record<string, number> = {};
      (apps || []).forEach((a: any) => {
        conversionByStatus[a.status] = (conversionByStatus[a.status] || 0) + 1;
      });

      return { rejectionRate, avgAdvanceTimeHours, conversionByStatus };
    },
  });
}
