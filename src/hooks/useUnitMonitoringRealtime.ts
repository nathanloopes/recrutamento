import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to Supabase Realtime changes on unit_jobs and applications tables.
 * Invalidates relevant queries on any INSERT/UPDATE/DELETE event.
 */
export function useUnitMonitoringRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidateMonitoringQueries = () => {
      queryClient.invalidateQueries({ queryKey: ["unit_monitoring_data"] });
      queryClient.invalidateQueries({ queryKey: ["unit_job_detail"] });
      queryClient.invalidateQueries({ queryKey: ["unit_candidate_summary"] });
      queryClient.invalidateQueries({ queryKey: ["unit_jobs_global_listing"] });
    };

    const channel = supabase
      .channel("unit-monitoring-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "unit_jobs" },
        invalidateMonitoringQueries
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        invalidateMonitoringQueries
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload: any) => {
          const eventType = payload.new?.event_type ?? payload.old?.event_type;
          if (!["unit_job_stalled", "high_rejection_rate", "delayed_response", "candidate_auto_blocked"].includes(eventType)) {
            return;
          }

          queryClient.invalidateQueries({ queryKey: ["unit_monitoring_alerts"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
