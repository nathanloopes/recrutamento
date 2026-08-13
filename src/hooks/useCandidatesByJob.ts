import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSendNotification } from "@/hooks/useNotifications";
import { handleHiringCompleted, handleHiringReverted } from "@/lib/jobFillEngine";
import { useToast } from "@/hooks/use-toast";
import { toDocNames } from "@/lib/docNames";

export function useCandidatesByJob(unitJobId: string) {
  return useQuery({
    queryKey: ["candidates_by_job", unitJobId],
    enabled: !!unitJobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*, profiles:candidates!applications_candidate_id_fkey(id, full_name, email, phone, avatar_url, latitude, longitude, cep, address_json, gender, birth_date, is_active), pipeline_phases:current_phase(id, name, order_index), application_cycles!application_cycles_application_id_fkey(restart_mode, closed_at, cycle_number)")
        .eq("unit_job_id", unitJobId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Esconder candidatos com conta desativada (is_active=false na tabela candidates)
      const visibleApps = (data || []).filter((a: any) => a.profiles?.is_active !== false);

      // candidate_profiles has no FK from applications, so fetch separately by candidate_id
      const candidateIds = Array.from(new Set(visibleApps.map((a: any) => a.candidate_id).filter(Boolean)));
      let cpMap: Record<string, { birth_date: string | null; gender: string | null; cep: string | null; address_json: any }> = {};
      if (candidateIds.length > 0) {
        const { data: cps } = await supabase
          .from("candidate_profiles")
          .select("candidate_id, birth_date, gender, cep, address_json")
          .in("candidate_id", candidateIds);
        for (const cp of cps || []) {
          cpMap[(cp as any).candidate_id] = {
            birth_date: (cp as any).birth_date,
            gender: (cp as any).gender,
            cep: (cp as any).cep,
            address_json: (cp as any).address_json,
          };
        }
      }

      const enriched = visibleApps.map((app: any) => {
        const cycles = (app.application_cycles || []) as Array<{ restart_mode: string | null; closed_at: string | null; cycle_number: number }>;
        const active = cycles
          .filter((c) => c.closed_at === null)
          .sort((a, b) => (b.cycle_number || 0) - (a.cycle_number || 0))[0];
        const cp = cpMap[app.candidate_id];
        const addr = (cp?.address_json || {}) as any;
        const addrLat = addr?.latitude ?? addr?.lat ?? null;
        const addrLng = addr?.longitude ?? addr?.lng ?? addr?.lon ?? null;
        const mergedProfiles = {
          ...(app.profiles || {}),
          birth_date: app.profiles?.birth_date ?? cp?.birth_date ?? null,
          gender: app.profiles?.gender ?? cp?.gender ?? null,
          cep: app.profiles?.cep ?? cp?.cep ?? null,
          address_json: app.profiles?.address_json ?? cp?.address_json ?? null,
          latitude: app.profiles?.latitude ?? addrLat ?? null,
          longitude: app.profiles?.longitude ?? addrLng ?? null,
        };
        return { ...app, profiles: mergedProfiles, currentRestartMode: active?.restart_mode ?? null };
      });
      return (enriched as any[]).slice().sort((a, b) =>
        (a.profiles?.full_name || "").toLowerCase().localeCompare((b.profiles?.full_name || "").toLowerCase(), "pt-BR")
      );
    },
  });
}

export function useUnitJobDetail(unitJobId: string) {
  return useQuery({
    queryKey: ["unit_job_detail", unitJobId],
    enabled: !!unitJobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("*, jobs(id, title), units(id, name, city, state)")
        .eq("id", unitJobId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useAdvancePhase() {
  const qc = useQueryClient();
  const sendNotification = useSendNotification();
  return useMutation({
    mutationFn: async ({ applicationId, nextPhaseId, candidateId, phaseName }: { applicationId: string; nextPhaseId: string; candidateId?: string; phaseName?: string }) => {
      const { error } = await supabase
        .from("applications")
        .update({ current_phase: nextPhaseId } as any)
        .eq("id", applicationId);
      if (error) throw error;
      return { candidateId, phaseName, applicationId };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      if (result?.candidateId) {
        sendNotification.mutate({
          eventType: "phase_advanced",
          recipientId: result.candidateId,
          payload: {
            application_id: result.applicationId,
            phase_name: result.phaseName || "",
            _title: "Você avançou de fase! \ud83d\ude80",
            _body: `Você avançou para a fase ${result.phaseName || "seguinte"} do processo seletivo.`,
          },
        });
      }
    },
  });
}

export function useUpdateApplicationStatus() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ applicationId, status, unitJobId, previousStatus, workStartAt }: { applicationId: string; status: string; unitJobId?: string; previousStatus?: string; workStartAt?: string | null }) => {
      // `workStartAt`: só incluído no payload quando definido (contratação).
      // undefined => não altera a coluna; null/ISO => grava o valor recebido.
      const payload: Record<string, unknown> = { status };
      if (workStartAt !== undefined) payload.work_start_at = workStartAt;
      const { error } = await supabase
        .from("applications")
        .update(payload as any)
        .eq("id", applicationId);
      if (error) throw error;

      // Fluxo único de aprovação de entrevista: sempre liberar o teste pós-entrevista
      // (no-op se o cargo/unidade não tiver teste configurado).
      if (status === "aprovado") {
        try {
          const { releasePostInterviewTest } = await import("@/lib/releasePostInterviewTest");
          await releasePostInterviewTest(applicationId);
        } catch (e) {
          console.error("[useUpdateApplicationStatus] release post-interview test failed", e);
        }
      }


      // When hiring, auto-cancel all other active applications of this candidate
      if (status === "contratado") {
        const { data: hiredApp } = await supabase
          .from("applications")
          .select("candidate_id")
          .eq("id", applicationId)
          .single();

        if (hiredApp) {
          await supabase
            .from("applications")
            .update({ status: "desistente" as any, withdrawal_reason: "Cancelado automaticamente — candidato contratado em outra vaga" } as any)
            .eq("candidate_id", hiredApp.candidate_id)
            .neq("id", applicationId)
            .in("status", ["pendente" as any, "em_andamento" as any, "aprovado" as any]);

          // Update talent pool status to hired
          await supabase
            .from("talent_pool_entries")
            .update({ status: "hired" as any, last_interaction: new Date().toISOString() })
            .eq("candidate_id", hiredApp.candidate_id);
        }
      }

      // When hiring, check if job is now fully filled
      if (status === "contratado" && unitJobId) {
        const movedCount = await handleHiringCompleted(unitJobId);
        if (movedCount > 0) {
          return { movedToTalentPool: movedCount };
        }
      }

      // When un-hiring (contratado → anything except desligado), auto-reopen the job if needed.
      // For "desligado", the frontend shows a decision dialog — no auto-reopen here.
      if (previousStatus === "contratado" && status !== "contratado" && status !== "desligado" && unitJobId) {
        await handleHiringReverted(unitJobId);
      }

      return { movedToTalentPool: 0 };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["corporate_metrics"] });
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["app_counts_by_uj"] });
      if (result?.movedToTalentPool > 0) {
        toast({
          title: "Vaga preenchida!",
          description: `${result.movedToTalentPool} candidato(s) aprovado(s) foram movidos ao Banco de Talentos.`,
        });
      }
    },
  });
}

/**
 * Define/atualiza apenas a data-hora de início do trabalhador (`work_start_at`).
 * Usada para corrigir/definir a data após a contratação, direto no card do contratado.
 * `workStartAt`: ISO completo ou null (para limpar).
 */
export function useSetWorkStartAt() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ applicationId, workStartAt }: { applicationId: string; workStartAt: string | null }) => {
      const { error } = await supabase
        .from("applications")
        .update({ work_start_at: workStartAt } as any)
        .eq("id", applicationId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["candidate_timeline"] });
      qc.invalidateQueries({ queryKey: ["my_applications"] });
      toast({ title: "Data de início atualizada" });
    },
  });
}

export function usePauseCandidate() {
  const qc = useQueryClient();
  const sendNotification = useSendNotification();
  return useMutation({
    mutationFn: async ({
      applicationId,
      candidateId,
      reason,
      unitJobId,
    }: {
      applicationId: string;
      candidateId: string;
      reason: string;
      unitJobId: string;
    }) => {
      // 1. Update application status
      const { error: appErr } = await supabase
        .from("applications")
        .update({ status: "pausado" } as any)
        .eq("id", applicationId);
      if (appErr) throw appErr;

      // 2. Cancel pending interviews
      await supabase
        .from("interviews")
        .update({ status: "cancelled" } as any)
        .eq("application_id", applicationId)
        .in("status", ["confirmed", "rescheduled"]);

      // 3. Close open document requests
      await supabase
        .from("document_requests")
        .update({ status: "cancelled" } as any)
        .eq("application_id", applicationId)
        .in("status", ["open", "in_progress"]);

      // 4. Get unit info from unit_job
      const { data: ujData } = await supabase
        .from("unit_jobs")
        .select("unit_id, job_id")
        .eq("id", unitJobId)
        .single();

      // 5. Update talent_pool_entries
      await supabase
        .from("talent_pool_entries")
        .update({
          status: "on_hold",
          standby_reason: reason,
          last_job_id: ujData?.job_id || null,
          origin_unit_id: ujData?.unit_id || null,
          last_interaction: new Date().toISOString(),
        } as any)
        .eq("candidate_id", candidateId);

      // 6. Audit trail
      const { data: session } = await supabase.auth.getSession();
      await supabase.from("audit_trail").insert({
        actor_id: session.session?.user?.id || candidateId,
        action: "candidate_paused",
        target_type: "application",
        target_id: applicationId,
        context: { reason, unit_job_id: unitJobId },
      });

      // 7. Notify candidate
      sendNotification.mutate({
        eventType: "candidate_paused",
        recipientId: candidateId,
        payload: {
          reason,
          _title: "Candidatura pausada",
          _body: `Sua candidatura foi temporariamente pausada. Motivo: ${reason}`,
        },
        channel: "in_app",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["corporate_metrics"] });
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
    },
  });
}

/**
 * After dismissing a hired candidate, apply the admin's decision:
 * "aberta" → reopen the job for new candidacies
 * "pausada" → pause the job so it no longer appears publicly
 */
export function useApplyJobDecisionAfterDismissal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      unitJobId,
      decision,
    }: {
      unitJobId: string;
      decision: "aberta" | "pausada";
    }) => {
      await handleHiringReverted(unitJobId, decision);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["corporate_metrics"] });
    },
  });
}

export function useCandidateDocProgress(candidateIds: string[], applications?: any[]) {
  // Build candidateId → applicationId map
  const appMap = new Map<string, string>();
  (applications || []).forEach((a: any) => {
    if (a.candidate_id && a.id) appMap.set(a.candidate_id, a.id);
  });
  const applicationIds = Array.from(appMap.values()).filter(Boolean);

  return useQuery({
    queryKey: ["candidate_doc_progress", candidateIds, applicationIds],
    enabled: candidateIds.length > 0,
    queryFn: async () => {
      // Fetch document_requests scoped by application_id when available
      let requests: any[] = [];
      if (applicationIds.length > 0) {
        const { data, error } = await supabase
          .from("document_requests")
          .select("id, candidate_id, application_id, documents_list, custom_documents")
          .in("application_id", applicationIds);
        if (error) throw error;
        requests = data || [];
        // Also fetch orphan requests (no application_id) for these candidates
        const { data: orphans, error: oErr } = await supabase
          .from("document_requests")
          .select("id, candidate_id, application_id, documents_list, custom_documents")
          .in("candidate_id", candidateIds)
          .is("application_id", null);
        if (!oErr && orphans) {
          const existingIds = new Set(requests.map((r: any) => r.id));
          for (const o of orphans) {
            if (!existingIds.has(o.id)) requests.push(o);
          }
        }
      } else {
        const { data, error } = await supabase
          .from("document_requests")
          .select("id, candidate_id, application_id, documents_list, custom_documents")
          .in("candidate_id", candidateIds);
        if (error) throw error;
        requests = data || [];
      }

      // Collect all request_ids
      const requestIds = requests.map((r: any) => r.id);

      // Fetch all uploads
      let uploads: any[] = [];
      if (requestIds.length > 0) {
        const { data, error } = await supabase
          .from("document_uploads")
          .select("id, candidate_id, document_type, status, request_id")
          .in("request_id", requestIds);
        if (error) throw error;
        uploads = data || [];
      }

      // Build progress map per candidate (dedup doc names + count unique approved types)
      const progressMap: Record<string, { total: number; uploaded: number; approved: number }> = {};

      // Group requests by candidate
      const reqsByCand: Record<string, any[]> = {};
      for (const req of requests) {
        const cid = req.candidate_id;
        if (!reqsByCand[cid]) reqsByCand[cid] = [];
        reqsByCand[cid].push(req);
      }

      // Group uploads by candidate
      const uplsByCand: Record<string, any[]> = {};
      for (const upl of uploads) {
        const cid = upl.candidate_id;
        if (!uplsByCand[cid]) uplsByCand[cid] = [];
        uplsByCand[cid].push(upl);
      }

      for (const cid of candidateIds) {
        const candReqs = reqsByCand[cid] || [];
        const candUpls = uplsByCand[cid] || [];

        // Dedup doc names
        const docNames = new Set<string>();
        for (const req of candReqs) {
          for (const d of toDocNames(req.documents_list)) docNames.add(d);
          for (const d of toDocNames(req.custom_documents)) docNames.add(d);
        }

        // Build uploadsByType (latest status per doc type)
        const uploadsByType: Record<string, string[]> = {};
        for (const upl of candUpls) {
          const key = upl.document_type;
          if (!uploadsByType[key]) uploadsByType[key] = [];
          uploadsByType[key].push(upl.status);
        }

        let uploaded = 0;
        let approved = 0;
        for (const doc of docNames) {
          const statuses = uploadsByType[doc];
          if (statuses && statuses.length > 0) uploaded++;
          if (statuses && statuses.includes("approved")) approved++;
        }

        progressMap[cid] = { total: docNames.size, uploaded, approved };
      }

      return progressMap;
    },
  });
}

export function useCandidateDocRequests(candidateId: string | undefined, applicationId: string | undefined) {
  return useQuery({
    queryKey: ["candidate_doc_requests", candidateId, applicationId],
    enabled: !!candidateId && !!applicationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_requests")
        .select("*")
        .eq("candidate_id", candidateId!)
        .eq("application_id", applicationId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useExistingDocRequest(applicationId: string | undefined) {
  return useQuery({
    queryKey: ["existing_doc_request", applicationId],
    enabled: !!applicationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_requests")
        .select("id, status")
        .eq("application_id", applicationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCandidateDetail(candidateId: string | undefined, applicationId: string | undefined) {
  const results = useQueries({
    queries: [
      {
        queryKey: ["candidate_profile", candidateId],
        enabled: !!candidateId,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", candidateId!)
            .single();
          if (error) throw error;
          return data;
        },
      },
      {
        queryKey: ["candidate_documents", candidateId, applicationId],
        enabled: !!candidateId && !!applicationId,
        queryFn: async () => {
          // Fetch request_ids for THIS application only
          const { data: reqs } = await supabase
            .from("document_requests")
            .select("id")
            .eq("application_id", applicationId!);
          const reqIds = (reqs || []).map((r: any) => r.id);
          if (reqIds.length === 0) return [];
          // Fetch uploads scoped to these request_ids
          const { data, error } = await supabase
            .from("document_uploads")
            .select("*")
            .in("request_id", reqIds)
            .order("uploaded_at", { ascending: false });
          if (error) throw error;
          return data;
        },
      },
      {
        queryKey: ["candidate_step_responses", applicationId],
        enabled: !!applicationId,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("step_responses")
            .select("*, pipeline_steps:step_id(id, title, weight, phase_id, pipeline_phases:phase_id(id, phase_kind, name))")
            .eq("application_id", applicationId!)
            .order("created_at", { ascending: true });
          if (error) throw error;
          return data as any[];
        },
      },
      {
        queryKey: ["candidate_interviews", applicationId],
        enabled: !!applicationId,
        queryFn: async () => {
          const { data, error } = await supabase
            .from("interviews")
            .select("*, profiles:candidate_id(id, full_name, email, phone), applications:application_id(id, unit_job_id, unit_jobs(id, jobs(id, title))), attendance_logs(id, attendance_status, check_in_time)")
            .eq("application_id", applicationId!)
            .order("scheduled_date", { ascending: false });
          if (error) throw error;
          return data;
        },
      },
    ],
  });

  return {
    profile: results[0].data,
    documents: results[1].data || [],
    stepResponses: results[2].data || [],
    interviews: results[3].data || [],
    isLoading: results.some((r) => r.isLoading),
  };
}

/**
 * Fetch active interviews (agendada/remarcada/reagendamento_solicitado) for a list of application IDs.
 * Returns a map: applicationId → { id, scheduled_date, scheduled_time, status }
 */
export function useCandidateInterviews(applicationIds: string[]) {
  return useQuery({
    queryKey: ["candidate_interviews_batch", applicationIds],
    enabled: applicationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interviews")
        .select("id, application_id, scheduled_date, scheduled_time, status")
        .in("application_id", applicationIds)
        .in("status", ["confirmed", "rescheduled", "reschedule_requested", "pending_approval", "completed", "no_show"]);
      if (error) throw error;
      const map: Record<string, { id: string; scheduled_date: string; scheduled_time: string; status: string }> = {};
      (data || []).forEach((iv: any) => {
        // Keep the first (most recent per application)
        if (!map[iv.application_id]) {
          map[iv.application_id] = iv;
        }
      });
      return map;
    },
  });
}
