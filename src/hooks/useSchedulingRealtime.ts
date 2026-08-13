import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to Supabase Realtime for the interviews table.
 * Invalidates scheduling-related queries on any change.
 */
export function useSchedulingRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("scheduling-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interviews" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["interviews"] });
          queryClient.invalidateQueries({ queryKey: ["my_interviews"] });
          queryClient.invalidateQueries({ queryKey: ["interview_for_app"] });
          queryClient.invalidateQueries({ queryKey: ["interviews_by_month"] });
          queryClient.invalidateQueries({ queryKey: ["pending_approvals"] });
          queryClient.invalidateQueries({ queryKey: ["interview_metrics"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
