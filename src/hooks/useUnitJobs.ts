import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyJobStatusChange } from "@/lib/jobStatusNotifications";
import { cancelScheduledStepsForUnitJob } from "@/lib/cancelJobScheduledSteps";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchAutomationEvent } from "@/lib/automationEngine";

export function useUnitJobs(filters?: {
  status?: string;
  unitId?: string;
  unitIds?: string[];
  city?: string;
  state?: string;
  jobId?: string;
  isFranqueadora?: boolean;
}) {
  return useQuery({
    queryKey: ["unit_jobs", filters],
    queryFn: async () => {
      let q = supabase
        .from("unit_jobs")
        .select("*, benefits_override, responsibilities_override, requirements_override, jobs(id, title, description, is_active, requires_ai_interview, requires_human_interview, allows_career_plan, department_id, benefits, responsibilities, requirements), units(id, name, city, state, cep, is_franqueadora)")
        .order("created_at", { ascending: false });
      if (filters?.status) q = q.eq("status", filters.status as any);
      if (filters?.unitIds && filters.unitIds.length > 0) q = q.in("unit_id", filters.unitIds);
      else if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
      if (filters?.jobId) q = q.eq("job_id", filters.jobId);
      if (filters?.isFranqueadora !== undefined)
        q = q.eq("units.is_franqueadora", filters.isFranqueadora);
      const { data, error } = await q;
      if (error) throw error;
      let results = data || [];
      if (filters?.city)
        results = results.filter((r: any) => r.units?.city === filters.city);
      if (filters?.state)
        results = results.filter((r: any) => r.units?.state === filters.state);
      if (filters?.isFranqueadora !== undefined)
        results = results.filter((r: any) => r.units?.is_franqueadora === filters.isFranqueadora);
      return results.slice().sort((a: any, b: any) => {
        const at = (a.jobs?.title || "").toLowerCase();
        const bt = (b.jobs?.title || "").toLowerCase();
        if (at !== bt) return at.localeCompare(bt, "pt-BR");
        const au = (a.units?.name || "").toLowerCase();
        const bu = (b.units?.name || "").toLowerCase();
        return au.localeCompare(bu, "pt-BR");
      });
    },
  });
}

export function useCorporateMetrics() {
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["corporate_metrics", isSuperAdmin, unitIds],
    queryFn: async () => {
      // Admin vê todas as vagas do sistema; demais perfis só das suas unidades
      let q = supabase
        .from("unit_jobs")
        .select("id, status, unit_id");
      if (!isSuperAdmin) {
        if (unitIds.length === 0) {
          return { activeJobs: 0, totalCandidates: 0, conversionRate: 0, avgScore: 0, byStatus: {} };
        }
        q = q.in("unit_id", unitIds);
      }
      const { data: unitJobs, error: ujError } = await q;
      if (ujError) throw ujError;

      const jobIds = (unitJobs || []).map((uj: any) => uj.id);
      const activeJobs = (unitJobs || []).filter((uj: any) => uj.status === "aberta").length;

      if (jobIds.length === 0) {
        return { activeJobs, totalCandidates: 0, conversionRate: 0, avgScore: 0, byStatus: {} };
      }

      const { data: apps, error: appError } = await supabase
        .from("applications")
        .select("id, status, total_score")
        .in("unit_job_id", jobIds);
      if (appError) throw appError;

      const totalCandidates = (apps || []).length;
      const hired = (apps || []).filter((a: any) => a.status === "contratado").length;
      const conversionRate = totalCandidates > 0 ? Math.round((hired / totalCandidates) * 100) : 0;
      const scores = (apps || []).map((a: any) => a.total_score).filter((s: any) => s != null && s > 0);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

      const byStatus: Record<string, number> = {};
      (apps || []).forEach((a: any) => {
        byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      });

      return { activeJobs, totalCandidates, conversionRate, avgScore, byStatus };
    },
  });
}

export function useApplicationCountByUnitJob(unitJobIds: string[]) {
  return useQuery({
    queryKey: ["app_counts_by_uj", unitJobIds],
    enabled: unitJobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("unit_job_id, status")
        .in("unit_job_id", unitJobIds);
      if (error) throw error;
      const counts: Record<string, { total: number; byStatus: Record<string, number> }> = {};
      (data || []).forEach((a: any) => {
        if (!counts[a.unit_job_id]) counts[a.unit_job_id] = { total: 0, byStatus: {} };
        counts[a.unit_job_id].total++;
        counts[a.unit_job_id].byStatus[a.status] = (counts[a.unit_job_id].byStatus[a.status] || 0) + 1;
      });
      return counts;
    },
  });
}

export function useCreateUnitJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (uj: {
      job_id: string; unit_id: string; salary?: number | null;
      work_model?: string; openings?: number; candidate_filters?: any;
      contract_type?: string;
      address_cep?: string | null; address_street?: string | null; address_number?: string | null;
      address_neighborhood?: string | null; address_city?: string | null; address_state?: string | null;
      address_complement?: string | null;
      work_hours_weekly?: number | null;
      opens_at?: string | null; closes_at?: string | null;
    }) => {
      // ── Enforcement: allowed_roles from unit_policies ──
      const { data: unitPolicy } = await supabase
        .from("unit_policies")
        .select("allowed_roles")
        .eq("unit_id", uj.unit_id)
        .maybeSingle();

      const { data: jobData } = await supabase.from("jobs").select("title").eq("id", uj.job_id).single();
      const jobTitle = jobData?.title || "";

      if (unitPolicy?.allowed_roles && Array.isArray(unitPolicy.allowed_roles) && unitPolicy.allowed_roles.length > 0) {
        const allowedLower = unitPolicy.allowed_roles.map((r: string) => r.toLowerCase());
        if (jobTitle && !allowedLower.includes(jobTitle.toLowerCase())) {
          throw new Error(`Cargo "${jobTitle}" não está na lista de cargos permitidos para esta unidade: ${unitPolicy.allowed_roles.join(", ")}`);
        }
      }

      // ── Enforcement: default_allowed_roles from CrossConfig ──
      const { data: defaultRolesSetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "units")
        .eq("key", "default_allowed_roles")
        .maybeSingle();

      if (defaultRolesSetting?.value && Array.isArray(defaultRolesSetting.value) && defaultRolesSetting.value.length > 0) {
        const globalAllowedLower = defaultRolesSetting.value.map((r: string) => r.toLowerCase());
        if (jobTitle && !globalAllowedLower.includes(jobTitle.toLowerCase())) {
          throw new Error(`Cargo "${jobTitle}" não está na lista global de cargos permitidos: ${defaultRolesSetting.value.join(", ")}`);
        }
      }

      // ── Enforcement: bloquear duplicidade de vaga ativa para mesmo cargo+unidade ──
      const { data: existingActive } = await supabase
        .from("unit_jobs")
        .select("id, status")
        .eq("job_id", uj.job_id)
        .eq("unit_id", uj.unit_id)
        .in("status", ["aberta", "pausada"] as any)
        .limit(1);
      if (existingActive && existingActive.length > 0) {
        throw new Error(
          `Já existe uma vaga ativa para "${jobTitle || "este cargo"}" nessa unidade. Encerre a vaga atual antes de abrir uma nova.`
        );
      }

      const { data, error } = await supabase.from("unit_jobs").insert({
        job_id: uj.job_id,
        unit_id: uj.unit_id,
        salary: uj.salary ?? null,
        work_model: uj.work_model ?? "presencial",
        openings: uj.openings ?? 1,
        candidate_filters: uj.candidate_filters ?? null,
        contract_type: uj.contract_type ?? "clt",
        address_cep: uj.address_cep ?? null,
        address_street: uj.address_street ?? null,
        address_number: uj.address_number ?? null,
        address_neighborhood: uj.address_neighborhood ?? null,
        address_city: uj.address_city ?? null,
        address_state: uj.address_state ?? null,
        address_complement: uj.address_complement ?? null,
        work_hours_weekly: uj.work_hours_weekly ?? null,
        opens_at: uj.opens_at ?? null,
        closes_at: uj.closes_at ?? null,
      } as any).select().single();
      if (error) throw error;

      // Audit log
      const { data: userData } = await supabase.auth.getUser();
      supabase.from("activity_logs").insert({
        user_id: userData.user?.id ?? null,
        action: "vaga_corporativa_criada",
        module: "vagas",
        details: { unit_job_id: data.id, job_id: uj.job_id, work_model: uj.work_model || "presencial", contract_type: uj.contract_type || "clt" },
      } as any).then(() => {});

      // Notification: onCorporateJobCreate
      supabase.from("notifications").insert({
        event_type: "corporate_job_created",
        recipient_id: userData.user?.id ?? null,
        channel: "push",
        title: "Nova vaga corporativa criada",
        body: `Uma nova vaga foi publicada para o cargo selecionado.`,
        status: "sent",
        payload: { unit_job_id: data.id, job_id: uj.job_id },
        action_url: "/admin/vagas",
      } as any).then(() => {});

      // Auto-geocode the unit if it has no coordinates
      try {
        const { data: unit } = await supabase
          .from("units")
          .select("id, latitude, longitude, cep, city, state")
          .eq("id", uj.unit_id)
          .single();
        if (unit && !unit.latitude && !unit.longitude && (unit.cep || (unit.city && unit.state))) {
          supabase.functions.invoke("geocode-cep", {
            body: {
              cep: unit.cep || "",
              table: "units",
              record_id: unit.id,
              city: unit.city,
              state: unit.state,
            },
          }).catch(() => {});
        }
      } catch {}

      // Dispatch automation event: new_job_opened
      dispatchAutomationEvent("new_job_opened", {
        unit_job_id: data.id,
        unit_id: uj.unit_id,
        job_id: uj.job_id,
      }).catch(() => {});

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["corporate_metrics"] });
    },
  });
}

export function useUpdateUnitJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      // Item 11: Block salary edit if allow_unit_salary_edit is false (non-admin users)
      if (updates.salary !== undefined) {
        const { data: salaryFlag } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "jobs")
          .eq("key", "allow_unit_salary_edit")
          .maybeSingle();
        const allowed = salaryFlag?.value !== false && salaryFlag?.value !== "false";
        if (!allowed) {
          // Check if user is admin — admins can always edit
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user) {
            const { data: roles } = await supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", userData.user.id)
              .in("role", ["admin", "rh_franqueadora"]);
            if (!roles || roles.length === 0) {
              throw new Error("Edição de salário não permitida pelas configurações globais.");
            }
          }
        }
      }

      // Guard: captura o status anterior para só notificar quando ele muda de fato.
      let previousStatus: string | undefined;
      if (updates.status) {
        const { data: prev } = await supabase
          .from("unit_jobs")
          .select("status")
          .eq("id", id)
          .maybeSingle();
        previousStatus = (prev as any)?.status;
      }

      const { data, error } = await supabase.from("unit_jobs").update(updates as any).eq("id", id).select().single();
      if (error) throw error;

      // Audit log
      const { data: userData } = await supabase.auth.getUser();
      supabase.from("activity_logs").insert({
        user_id: userData.user?.id ?? null,
        action: updates.status ? "vaga_corporativa_status" : "vaga_corporativa_editada",
        module: "vagas",
        details: { unit_job_id: id, changes: updates },
      } as any).then(() => {});

      // Mudança de status da vaga → notifica os candidatos DESTA vaga específica
      // (unit_job_id) reutilizando o mecanismo de templates existente
      // (send-notification-cascade → push + template WhatsApp `mudanca_status_vaga`).
      // Só dispara se o status REALMENTE mudou. "encerrada" segue em useCloseJob.
      // Vaga deixou de estar disponível (aberta → qualquer outro status):
      // cancela em cascata as etapas futuras ainda pendentes (entrevistas,
      // bate-papos, testes, documentos) e move candidaturas p/ standby.
      // Roda ANTES de notificar (as candidaturas em standby ainda são notificadas).
      const becameUnavailable =
        previousStatus === "aberta" && !!updates.status && updates.status !== "aberta";
      if (becameUnavailable) {
        await cancelScheduledStepsForUnitJob(id, { reason: `vaga_${updates.status}` });
      }

      if (
        updates.status &&
        updates.status !== previousStatus &&
        (updates.status === "pausada" || updates.status === "preenchida")
      ) {
        await notifyJobStatusChange(id, updates.status);
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["corporate_metrics"] });
    },
  });
}

export function useFranqueadoraUnit() {
  return useQuery({
    queryKey: ["franqueadora_unit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("*")
        .eq("is_franqueadora", true)
        .eq("is_active", true)
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useUnitJobDeleteImpact(unitJobId: string | null | undefined) {
  return useQuery({
    queryKey: ["unit_job_delete_impact", unitJobId],
    enabled: !!unitJobId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_unit_job_delete_impact" as any, {
        _unit_job_id: unitJobId,
      });
      if (error) throw error;
      return (data || {}) as Record<string, number>;
    },
  });
}

export function useDeleteUnitJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (unitJobId: string) => {
      const { data: ujRow } = await supabase
        .from("unit_jobs")
        .select("status")
        .eq("id", unitJobId)
        .maybeSingle();
      const status = (ujRow as any)?.status as string | undefined;

      const { count: activeCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("unit_job_id", unitJobId)
        .in("status", ["em_andamento", "standby", "aprovado"] as any);

      if ((status === "aberta" || status === "pausada") && (activeCount || 0) > 0) {
        throw new Error("BLOCKED:NEEDS_CLOSE");
      }

      let impact: any = null;
      try {
        const { data: imp } = await supabase.rpc("get_unit_job_delete_impact" as any, {
          _unit_job_id: unitJobId,
        });
        impact = imp;
      } catch {}

      const { error } = await supabase.from("unit_jobs").delete().eq("id", unitJobId);
      if (error) throw error;

      const { data: userData } = await supabase.auth.getUser();
      supabase.from("activity_logs").insert({
        user_id: userData.user?.id ?? null,
        action: "vaga_corporativa_excluida",
        module: "vagas",
        details: {
          unit_job_id: unitJobId,
          prior_status: status,
          active_apps_at_delete: activeCount || 0,
          impact,
        },
      } as any).then(() => {});

      return { impact };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["corporate_metrics"] });
      qc.invalidateQueries({ queryKey: ["app_counts_by_uj"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["candidate_progress_logs"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
    },
  });
}



export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data, error } = await supabase.from("units").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });
}

// --- Close Job with mass notification ---

export function useCloseJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (unitJobId: string) => {
      // Guard: só notifica se a vaga ainda NÃO estava encerrada (evita reenvio).
      const { data: prevJob } = await supabase
        .from("unit_jobs")
        .select("status")
        .eq("id", unitJobId)
        .maybeSingle();
      const wasAlreadyClosed = (prevJob as any)?.status === "encerrada";

      // 1. Update job status to encerrada
      const { error: updateErr } = await supabase
        .from("unit_jobs")
        .update({ status: "encerrada" } as any)
        .eq("id", unitJobId);
      if (updateErr) throw updateErr;

      // 2+3. Cancela em cascata as etapas futuras pendentes (entrevistas,
      // bate-papos, testes pós-entrevista, documentos, notificações pendentes)
      // e move as candidaturas ativas para standby. Helper compartilhado com o
      // fluxo de pausar/preencher (useUpdateUnitJob).
      const { affectedApplications } = await cancelScheduledStepsForUnitJob(unitJobId, {
        reason: "vaga_encerrada",
      });

      // 4. Notifica os candidatos DESTA vaga reutilizando o mecanismo de templates
      // existente (send-notification-cascade → push + template WhatsApp
      // `mudanca_status_vaga`). Só dispara se a vaga não estava já encerrada.
      if (!wasAlreadyClosed) {
        await notifyJobStatusChange(unitJobId, "encerrada");
      }

      // 5. Audit log
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("activity_logs").insert({
        user_id: userData.user?.id ?? null,
        action: "vaga_encerrada",
        module: "vagas",
        details: { unit_job_id: unitJobId, candidates_notified: affectedApplications },
      } as any);

      return { notified: affectedApplications };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["corporate_metrics"] });
      qc.invalidateQueries({ queryKey: ["app_counts_by_uj"] });
    },
  });
}
