import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

/**
 * Realtime: invalidates application_aso query when the row for this
 * application changes (admin schedules, candidate uploads laudo, etc.).
 */
export function useApplicationAsoRealtime(applicationId?: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!applicationId) return;
    const channel = supabase
      .channel(`application_aso:${applicationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "application_aso",
          filter: `application_id=eq.${applicationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["application_aso", applicationId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [applicationId, qc]);
}


export interface AsoRow {
  id: string;
  application_id: string;
  candidate_id: string;
  unit_id: string | null;
  address: string | null;
  scheduled_date: string | null; // YYYY-MM-DD
  scheduled_time: string | null; // HH:MM:SS
  status:
    | "pendente_agendamento"
    | "agendado"
    | "laudo_enviado"
    | "aprovado"
    | "reprovado";
  laudo_file_url: string | null;
  laudo_uploaded_at: string | null;
  scheduled_by: string | null;
  scheduled_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches the ASO row for an application (one per application).
 */
export function useApplicationAso(applicationId?: string | null) {
  return useQuery({
    queryKey: ["application_aso", applicationId],
    enabled: !!applicationId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("application_aso")
        .select("*")
        .eq("application_id", applicationId)
        .maybeSingle();
      if (error) throw error;
      return (data as AsoRow | null) ?? null;
    },
  });
}

/**
 * Gate: returns true when ALL required-document uploads exist (any status).
 * Used to enable the ASO scheduling section.
 */
export function useAsoSchedulingGate(applicationId?: string | null) {
  return useQuery({
    queryKey: ["aso_scheduling_gate", applicationId],
    enabled: !!applicationId,
    staleTime: 15_000,
    queryFn: async () => {
      // Find requests linked to this application
      const { data: reqs } = await supabase
        .from("document_requests")
        .select("id, documents_list, custom_documents, status")
        .eq("application_id", applicationId!);

      const ids: string[] = [];
      const requiredDocs: string[] = [];
      for (const r of reqs || []) {
        if ((r as any).status === "cancelled") continue;
        ids.push(r.id);
        const lists = [
          ...(((r as any).documents_list as any[]) || []),
          ...(((r as any).custom_documents as any[]) || []),
        ];
        for (const item of lists) {
          if (typeof item === "string") requiredDocs.push(item);
          else if (item?.name && item?.required !== false)
            requiredDocs.push(item.name);
        }
      }
      const reqSet = new Set(requiredDocs);
      if (reqSet.size === 0) return { canSchedule: false, missing: 0 };

      const { data: uploads } = await supabase
        .from("document_uploads")
        .select("document_type, status")
        .in("request_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

      const sent = new Set(
        (uploads || [])
          .filter((u: any) => u.status !== "cancelled")
          .map((u: any) => u.document_type),
      );
      let missing = 0;
      for (const r of reqSet) if (!sent.has(r)) missing++;
      return { canSchedule: missing === 0, missing, total: reqSet.size };
    },
  });
}

// ---------- Mutations (admin/franqueado) ----------

export function useScheduleAso() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      applicationId: string;
      candidateId: string;
      unitId?: string | null;
      address: string;
      scheduledDate: string; // YYYY-MM-DD
      scheduledTime: string; // HH:MM
    }) => {
      const payload = {
        application_id: input.applicationId,
        candidate_id: input.candidateId,
        unit_id: input.unitId ?? null,
        address: input.address,
        scheduled_date: input.scheduledDate,
        scheduled_time: input.scheduledTime,
        status: "agendado",
        scheduled_by: user?.id ?? null,
        scheduled_at: new Date().toISOString(),
      };
      const { data, error } = await (supabase as any)
        .from("application_aso")
        .upsert(payload, { onConflict: "application_id" })
        .select()
        .maybeSingle();
      if (error) throw error;

      // Fire push to candidate (best-effort)
      try {
        await supabase.functions.invoke("notify-aso-scheduled", {
          body: { applicationId: input.applicationId },
        });
      } catch (_) {
        /* noop */
      }
      return data as AsoRow;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["application_aso", vars.applicationId] });
      toast({ title: "ASO agendado", description: "O candidato foi notificado." });
    },
    onError: (e: any) =>
      toast({
        title: "Erro ao agendar",
        description: e.message,
        variant: "destructive",
      }),
  });
}

export function useApproveAso() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { asoId: string; applicationId: string }) => {
      const { error } = await (supabase as any)
        .from("application_aso")
        .update({
          status: "aprovado",
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
          rejection_reason: null,
        })
        .eq("id", input.asoId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["application_aso", vars.applicationId] });
      qc.invalidateQueries({ queryKey: ["application_docs_pending"] });
      toast({ title: "ASO aprovado" });
    },
    onError: (e: any) =>
      toast({
        title: "Erro",
        description: e.message,
        variant: "destructive",
      }),
  });
}

export function useRejectAso() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      asoId: string;
      applicationId: string;
      reason: string;
    }) => {
      const { error } = await (supabase as any)
        .from("application_aso")
        .update({
          status: "reprovado",
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
          rejection_reason: input.reason,
        })
        .eq("id", input.asoId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["application_aso", vars.applicationId] });
      toast({ title: "ASO reprovado", description: "O candidato foi notificado." });
    },
    onError: (e: any) =>
      toast({
        title: "Erro",
        description: e.message,
        variant: "destructive",
      }),
  });
}

// ---------- Mutation (candidate uploads laudo) ----------

export function useUploadAsoLaudo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      asoId: string;
      applicationId: string;
      candidateId: string;
      file: File;
    }) => {
      const ext = input.file.name.split(".").pop() || "pdf";
      const path = `${input.candidateId}/${input.applicationId}-${Date.now()}.${ext}`;
      const storage = await getStorageClient();
      const up = await storage.storage
        .from("aso-laudos")
        .upload(path, input.file, { upsert: true });
      if (up.error) throw up.error;
      const { error } = await (supabase as any)
        .from("application_aso")
        .update({
          laudo_file_url: path,
          laudo_uploaded_at: new Date().toISOString(),
          status: "laudo_enviado",
          rejection_reason: null,
        })
        .eq("id", input.asoId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["application_aso", vars.applicationId] });
      toast({
        title: "Laudo enviado",
        description: "Aguarde a aprovação do franqueado.",
      });
    },
    onError: (e: any) =>
      toast({
        title: "Erro no envio",
        description: e.message,
        variant: "destructive",
      }),
  });
}
