import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sendPushToDevice } from "@/hooks/useNotifications";

export interface JobRequest {
  id: string;
  requested_by: string;
  unit_id: string;
  job_id: string | null;
  title: string;
  description: string | null;
  salary: number | null;
  work_model: string;
  openings: number;
  benefits: string[];
  responsibilities: string[];
  requirements: string[];
  reference_cep: string | null;
  reference_radius_km: number | null;
  reference_lat: number | null;
  reference_lng: number | null;
  status: "pendente" | "em_analise" | "aprovada" | "reprovada";
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_unit_job_id: string | null;
  created_at: string;
  updated_at: string;
  // joined
  requester?: { full_name: string };
  unit?: { name: string; city: string; state: string };
  reviewer?: { full_name: string };
}

export interface JobRequestFilters {
  status?: string;
  unitId?: string;
}

export function useJobRequests(filters?: JobRequestFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["job_requests", filters],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("job_requests" as any)
        .select("*, requester:profiles!job_requests_requested_by_profile_fkey(full_name), unit:units!job_requests_unit_id_fkey(name, city, state), reviewer:profiles!job_requests_reviewed_by_profile_fkey(full_name)")
        .order("created_at", { ascending: false });

      if (filters?.status && filters.status !== "all") {
        q = q.eq("status", filters.status);
      }
      if (filters?.unitId && filters.unitId !== "all") {
        q = q.eq("unit_id", filters.unitId);
      }

      const { data: rawData, error } = await q;
      if (error) throw error;
      const data = (rawData || []).slice().sort((a: any, b: any) => {
        const au = (a.unit?.name || "").toLowerCase();
        const bu = (b.unit?.name || "").toLowerCase();
        if (au !== bu) return au.localeCompare(bu, "pt-BR");
        return String(a.job_title || "").toLowerCase().localeCompare(String(b.job_title || "").toLowerCase(), "pt-BR");
      });
      return (data as unknown as JobRequest[]) || [];
    },
  });
}

export function useCreateJobRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (values: {
      unit_id: string;
      job_id?: string | null;
      title: string;
      description?: string;
      salary?: number | null;
      work_model?: string;
      openings?: number;
      benefits?: string[];
      responsibilities?: string[];
      requirements?: string[];
      reference_cep?: string | null;
      reference_radius_km?: number | null;
      reference_lat?: number | null;
      reference_lng?: number | null;
    }) => {
      if (!user) throw new Error("Não autenticado");

      const { data, error } = await supabase
        .from("job_requests" as any)
        .insert({
          requested_by: user.id,
          unit_id: values.unit_id,
          job_id: values.job_id ?? null,
          title: values.title,
          description: values.description || null,
          salary: values.salary ?? null,
          work_model: values.work_model || "presencial",
          openings: values.openings || 1,
          benefits: values.benefits || [],
          responsibilities: values.responsibilities || [],
          requirements: values.requirements || [],
          reference_cep: values.reference_cep ?? null,
          reference_radius_km: values.reference_radius_km ?? null,
          reference_lat: values.reference_lat ?? null,
          reference_lng: values.reference_lng ?? null,
          status: "pendente",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const requestId = (data as any).id;

      // Audit log
      await supabase.from("activity_logs").insert({
        user_id: user.id,
        action: "job_request_created",
        module: "vagas_corporativas",
        details: { request_id: requestId, title: values.title, unit_id: values.unit_id },
      } as any);

      // DB trigger already created notifications for admins.
      // Dispatch native push directly to admin users.
      try {
        const { data: admins } = await supabase
          .from("user_roles" as any)
          .select("user_id")
          .in("role", ["admin", "rh_franqueadora"] as any);

        if (admins?.length) {
          for (const admin of admins as any[]) {
            if (admin.user_id === user.id) continue;
            sendPushToDevice({
              recipientId: admin.user_id,
              title: "Nova solicitação de vaga",
              body: `Solicitação: "${values.title}" aguardando análise.`,
              actionUrl: "/admin/vagas",
            }).catch(() => {});
          }
        }
      } catch {}

      return { id: requestId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job_requests"] });
    },
  });
}

export function useReviewJobRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      review_note,
    }: {
      id: string;
      status: "em_analise" | "aprovada" | "reprovada";
      review_note?: string;
    }) => {
      if (!user) throw new Error("Não autenticado");

      // Fetch the full request BEFORE any update (we may need it to build the unit_job)
      const { data: request } = await supabase
        .from("job_requests" as any)
        .select("requested_by, title, unit_id, job_id, salary, work_model, openings, benefits, responsibilities, requirements, reference_cep, reference_radius_km, reference_lat, reference_lng")
        .eq("id", id)
        .single();

      let createdUnitJobId: string | null = null;

      // When approving, create the unit_job FIRST and only then flip status.
      // This avoids a stuck "aprovada" state with no active vaga if the insert fails.
      if (status === "aprovada" && request) {
        const req = request as any;

        // Resolve job: ALWAYS reuse an existing cargo. Never create a new one here.
        let jobId: string | null = req.job_id || null;

        if (!jobId) {
          const cleanTitle = String(req.title || "").trim();
          const { data: existingJobs } = await supabase
            .from("jobs")
            .select("id, is_active")
            .ilike("title", cleanTitle)
            .order("is_active", { ascending: false })
            .limit(1);

          if (existingJobs && existingJobs.length > 0) {
            jobId = existingJobs[0].id;
          } else {
            throw new Error(
              `Não foi possível aprovar: nenhum cargo institucional encontrado para "${cleanTitle}". Cadastre o cargo em "Cargos" antes de aprovar a solicitação.`
            );
          }
        }

        // Block duplicate active unit_job for same cargo + unidade
        const { data: existingActive } = await supabase
          .from("unit_jobs")
          .select("id, status")
          .eq("job_id", jobId)
          .eq("unit_id", req.unit_id)
          .in("status", ["aberta", "pausada"] as any)
          .limit(1);
        if (existingActive && existingActive.length > 0) {
          throw new Error(
            "Já existe uma vaga ativa para este cargo nessa unidade. Encerre a vaga atual antes de aprovar uma nova solicitação."
          );
        }

        const candidateFilters: Record<string, any> = {};
        if (req.reference_lat && req.reference_lng) {
          candidateFilters.cep_lat = req.reference_lat;
          candidateFilters.cep_lng = req.reference_lng;
          candidateFilters.cep_ref = (req.reference_cep || "").replace(/\D/g, "");
          candidateFilters.radius_km = req.reference_radius_km ?? 10;
        }

        const exactSalary = req.salary == null ? null : Number(req.salary);

        const { data: unitJob, error: ujErr } = await supabase
          .from("unit_jobs")
          .insert({
            job_id: jobId,
            unit_id: req.unit_id,
            salary: exactSalary,
            work_model: req.work_model || "presencial",
            openings: req.openings || 1,
            ...(Object.keys(candidateFilters).length > 0 ? { candidate_filters: candidateFilters } : {}),
          } as any)
          .select("id")
          .single();
        if (ujErr) throw new Error("Erro ao criar vaga: " + ujErr.message);

        createdUnitJobId = unitJob.id;
      }

      // Now apply the status change (and link the created unit_job, if any)
      const updates: any = {
        status,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      };
      if (review_note !== undefined) updates.review_note = review_note;
      if (createdUnitJobId) updates.created_unit_job_id = createdUnitJobId;

      const { error } = await supabase
        .from("job_requests" as any)
        .update(updates)
        .eq("id", id);
      if (error) throw error;

      // Audit log
      await supabase.from("activity_logs").insert({
        user_id: user.id,
        action: `job_request_${status}`,
        module: "vagas_corporativas",
        details: { request_id: id, status, review_note },
      } as any);

      if (request) {
        const statusLabel = status === "aprovada" ? "aprovada" : status === "reprovada" ? "não aprovada" : "em análise";
        sendPushToDevice({
          recipientId: (request as any).requested_by,
          title: `Solicitação ${statusLabel}`,
          body: `Sua solicitação "${(request as any).title}" foi ${statusLabel}.${review_note ? ` Nota: ${review_note}` : ""}`,
          actionUrl: "/admin/vagas",
        }).catch(() => {});
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job_requests"] });
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
    },
  });
}
