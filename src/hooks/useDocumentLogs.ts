import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useDocumentLogs(requestId?: string) {
  return useQuery({
    queryKey: ["document_logs", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_logs" as any)
        .select("*")
        .eq("request_id", requestId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export async function insertDocumentLog(params: {
  candidate_id?: string;
  request_id?: string;
  document_type?: string;
  event: string;
  actor_id?: string;
  metadata?: Record<string, any>;
}) {
  await supabase.from("document_logs" as any).insert({
    candidate_id: params.candidate_id || null,
    request_id: params.request_id || null,
    document_type: params.document_type || null,
    event: params.event,
    actor_id: params.actor_id || null,
    metadata: params.metadata || {},
  } as any);
}
