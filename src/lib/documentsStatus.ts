import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toDocMetas, mergeDocMetas, type DocMeta } from "@/lib/docNames";

/**
 * Hook to determine if a candidate has pending REQUIRED documents.
 * Optional documents do NOT block the "Contratar" action.
 */
export function useApplicationDocsPending(applicationId?: string, candidateId?: string) {
  return useQuery({
    queryKey: ["application_docs_pending", applicationId, candidateId],
    enabled: !!applicationId,
    staleTime: 15_000,
    queryFn: async () => {
      const reqs: any[] = [];
      const { data: byApp } = await supabase
        .from("document_requests")
        .select("id, documents_list, custom_documents, status, application_id")
        .eq("application_id", applicationId!);
      reqs.push(...(byApp || []));
      if (candidateId) {
        const { data: orphans } = await supabase
          .from("document_requests")
          .select("id, documents_list, custom_documents, status, application_id")
          .eq("candidate_id", candidateId)
          .is("application_id", null);
        const seen = new Set(reqs.map((r) => r.id));
        for (const o of orphans || []) if (!seen.has(o.id)) reqs.push(o);
      }

      const allMetasRaw: DocMeta[] = [];
      const ids: string[] = [];
      let hasOpenRequest = false;
      for (const r of reqs) {
        if (r.status === "cancelled") continue;
        ids.push(r.id);
        if (r.status !== "completed") hasOpenRequest = true;
        allMetasRaw.push(...toDocMetas(r.documents_list));
        allMetasRaw.push(...toDocMetas(r.custom_documents));
      }

      // Source-of-truth required flag for legacy string entries.
      const { data: globalDocs } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "documents")
        .eq("key", "required_documents")
        .maybeSingle();
      const sourceMap = new Map(
        toDocMetas(globalDocs?.value).map((m) => [m.name, m.required]),
      );

      const merged = mergeDocMetas(allMetasRaw).map((m) => {
        const src = sourceMap.get(m.name);
        // Stored flag wins; fallback to global; default required.
        return { name: m.name, required: m.required && (src !== false) };
      });

      const requiredDocs = merged.filter((m) => m.required).map((m) => m.name);
      const total = requiredDocs.length;

      if (total === 0 || ids.length === 0) {
        // Sem solicitação ou sem documentos obrigatórios → trava de contratação ATIVA.
        return {
          hasPending: true,
          total: 0,
          sent: 0,
          pending: 0,
          hasOpenRequest: false,
          requiresDocsRequest: ids.length === 0,
        };
      }

      const { data: uploads } = await supabase
        .from("document_uploads")
        .select("document_type, status")
        .in("request_id", ids);

      const byType: Record<string, string[]> = {};
      (uploads || []).forEach((u: any) => {
        (byType[u.document_type] ||= []).push(u.status);
      });

      let pending = 0;
      let sent = 0;
      for (const name of requiredDocs) {
        const statuses = byType[name];
        if (!statuses || !statuses.includes("approved")) pending++;
        if (statuses && statuses.length > 0) sent++;
      }

      return {
        hasPending: pending > 0,
        total,
        sent,
        pending,
        hasOpenRequest,
        requiresDocsRequest: false,
      };
    },
  });
}

