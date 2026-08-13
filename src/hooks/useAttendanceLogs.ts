import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useAttendanceLogs(interviewId?: string) {
  return useQuery({
    queryKey: ["attendance_logs", interviewId],
    enabled: !!interviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_logs" as any)
        .select("*")
        .eq("interview_id", interviewId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useRecordAttendance() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (log: {
      interview_id: string;
      candidate_id: string;
      unit_id: string;
      attendance_status: "compareceu" | "no_show" | "atraso" | "unit_no_show";
      check_in_time?: string;
      check_out_time?: string;
      justification?: string;
    }) => {
      const { data, error } = await supabase
        .from("attendance_logs" as any)
        .insert({
          ...log,
          recorded_by: user?.id || null,
        } as any)
        .select()
        .single();
      if (error) throw error;

      // Also update interview status accordingly
      const statusMap: Record<string, string> = {
        compareceu: "completed",
        no_show: "no_show",
        atraso: "completed",
        unit_no_show: "no_show",
      };
      const newStatus = statusMap[log.attendance_status];
      if (newStatus) {
        await supabase
          .from("interviews")
          .update({ status: newStatus } as any)
          .eq("id", log.interview_id);
      }

      // Log in calendar_logs
      await supabase.from("calendar_logs").insert({
        user_id: user?.id || null,
        event_type: "attendance_recorded",
        rule_applied: null,
        context: {
          interview_id: log.interview_id,
          attendance_status: log.attendance_status,
          justification: log.justification || null,
        },
      } as any);

      // Dispatch automation event for no-show
      if (log.attendance_status === "no_show") {
        import("@/lib/automationEngine").then(({ dispatchAutomationEvent }) => {
          dispatchAutomationEvent("no_show_detected", {
            interview_id: log.interview_id,
            candidate_id: log.candidate_id,
            unit_id: log.unit_id,
          }).catch(() => {});
        });
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance_logs"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["interview_audit_metrics"] });
    },
  });
}

export function useInterviewDiagnostic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (unitId?: string) => {
      const { data, error } = await supabase.functions.invoke("diagnose-interviews", {
        body: { unit_id: unitId || null },
      });
      if (error) throw error;
      return data;
    },
  });
}
