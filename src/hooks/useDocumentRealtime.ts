import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to Supabase Realtime for document_uploads and document_requests.
 * Invalidates relevant queries on any change.
 */
export function useDocumentRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("document-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_uploads" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["document_uploads"] });
          queryClient.invalidateQueries({ queryKey: ["my_document_requests"] });
          queryClient.invalidateQueries({ queryKey: ["admin_document_requests"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_requests" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["document_request"] });
          queryClient.invalidateQueries({ queryKey: ["my_document_requests"] });
          queryClient.invalidateQueries({ queryKey: ["admin_document_requests"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
