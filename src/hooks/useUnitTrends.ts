import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subMonths, startOfMonth, format } from "date-fns";

export interface MonthlyTrend {
  month: string;
  total: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  conversionRate: number;
  rejectionRate: number;
  withdrawalRate: number;
}

/**
 * Fetches the last 6 months of application data grouped by month
 * to show trend charts on the monitoring dashboard.
 */
export function useUnitTrends() {
  return useQuery({
    queryKey: ["unit_monitoring_trends"],
    queryFn: async () => {
      const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5));

      const { data: apps, error } = await supabase
        .from("applications")
        .select("status, created_at")
        .gte("created_at", sixMonthsAgo.toISOString())
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Group by month
      const byMonth: Record<string, { total: number; hired: number; rejected: number; withdrawn: number }> = {};

      // Initialize last 6 months
      for (let i = 5; i >= 0; i--) {
        const d = subMonths(new Date(), i);
        const key = format(startOfMonth(d), "yyyy-MM");
        byMonth[key] = { total: 0, hired: 0, rejected: 0, withdrawn: 0 };
      }

      (apps || []).forEach((a: any) => {
        const key = format(new Date(a.created_at), "yyyy-MM");
        if (!byMonth[key]) return;
        byMonth[key].total++;
        if (a.status === "contratado") byMonth[key].hired++;
        if (a.status === "reprovado" || a.status === "standby") byMonth[key].rejected++;
        if (a.status === "desistente") byMonth[key].withdrawn++;
      });

      const trends: MonthlyTrend[] = Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, d]) => ({
          month: format(new Date(month + "-01"), "MMM/yy"),
          total: d.total,
          hired: d.hired,
          rejected: d.rejected,
          withdrawn: d.withdrawn,
          conversionRate: d.total > 0 ? Math.round((d.hired / d.total) * 100) : 0,
          rejectionRate: d.total > 0 ? Math.round((d.rejected / d.total) * 100) : 0,
          withdrawalRate: d.total > 0 ? Math.round((d.withdrawn / d.total) * 100) : 0,
        }));

      return trends;
    },
    staleTime: 5 * 60 * 1000,
  });
}
