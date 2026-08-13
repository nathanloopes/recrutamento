import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export function useJobs(activeOnly?: boolean) {
  return useQuery({
    queryKey: ["jobs", activeOnly],
    queryFn: async () => {
      let q = supabase.from("jobs").select("*, job_pipelines(id), unit_jobs(count), job_versions(count)").order("title");
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useJobVersions(jobId?: string) {
  return useQuery({
    queryKey: ["job_versions", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_versions")
        .select("*")
        .eq("job_id", jobId!)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job: TablesInsert<"jobs">) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Usuário não autenticado");

      // Read job_status_default from global_settings
      const { data: defaultSetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "jobs")
        .eq("key", "job_status_default")
        .maybeSingle();

      const isActive = defaultSetting?.value === "inativo" ? false : true;

      // Auto-generate code via RPC
      const category = (job as any).category || "unidade";
      const { data: generatedCode, error: codeError } = await supabase.rpc("generate_job_code", { _category: category });
      if (codeError) throw new Error("Erro ao gerar código do cargo: " + codeError.message);

      // Clamp min_score
      const minScore = Math.round(Math.min(100, Math.max(0, (job as any).min_score ?? 0)));

      // Cria o cargo
      const { data, error } = await supabase
        .from("jobs")
        .insert({ ...job, created_by: userId, is_active: job.is_active ?? isActive, code: generatedCode, min_score: minScore } as any)
        .select()
        .single();
      if (error) throw error;

      // Create version 1 snapshot
      const snapshot = {
        title: data.title,
        description: data.description,
        requires_ai_interview: data.requires_ai_interview,
        requires_human_interview: data.requires_human_interview,
        allows_career_plan: data.allows_career_plan,
        is_active: data.is_active,
        category: (data as any).category,
        code: (data as any).code,
        min_score: (data as any).min_score,
        requires_documents: (data as any).requires_documents,
        sede_only: (data as any).sede_only,
        benefits: (data as any).benefits,
        responsibilities: (data as any).responsibilities,
        requirements: (data as any).requirements,
        discovery_invite: (data as any).discovery_invite,
        discovery_traits: (data as any).discovery_traits,
        discovery_highlights: (data as any).discovery_highlights,
      };

      await supabase.from("job_versions").insert({
        job_id: data.id,
        version_number: 1,
        snapshot,
        change_reason: "Criação inicial do cargo",
        changed_by: userId,
      } as any);

      // Audit log
      await supabase.from("activity_logs").insert({
        user_id: userId,
        action: "cargo_criado",
        module: "cargos",
        details: { job_id: data.id, title: data.title },
      } as any);

      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      changeReason,
      ...updates
    }: TablesUpdate<"jobs"> & { id: string; changeReason?: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      // Fetch current state for snapshot
      const { data: current, error: fetchError } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", id)
        .single();
      if (fetchError) throw fetchError;

      // Get next version number
      const { data: versions } = await supabase
        .from("job_versions")
        .select("version_number")
        .eq("job_id", id)
        .order("version_number", { ascending: false })
        .limit(1);

      const nextVersion = (versions && versions.length > 0 ? versions[0].version_number : 0) + 1;

      // Create version snapshot of PREVIOUS state
      const snapshot = {
        title: current.title,
        description: current.description,
        requires_ai_interview: current.requires_ai_interview,
        requires_human_interview: current.requires_human_interview,
        allows_career_plan: current.allows_career_plan,
        is_active: current.is_active,
        category: (current as any).category,
        code: (current as any).code,
        min_score: (current as any).min_score,
        requires_documents: (current as any).requires_documents,
        sede_only: (current as any).sede_only,
        benefits: (current as any).benefits,
        responsibilities: (current as any).responsibilities,
        requirements: (current as any).requirements,
        discovery_invite: (current as any).discovery_invite,
        discovery_traits: (current as any).discovery_traits,
        discovery_highlights: (current as any).discovery_highlights,
      };

      await supabase.from("job_versions").insert({
        job_id: id,
        version_number: nextVersion,
        snapshot,
        change_reason: changeReason || null,
        changed_by: userId,
      } as any);

      // Apply the update
      const { data, error } = await supabase
        .from("jobs")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      // Audit log
      await supabase.from("activity_logs").insert({
        user_id: userId,
        action: "cargo_editado",
        module: "cargos",
        details: { job_id: id, changes: updates, version: nextVersion },
      } as any);

      // Auto-notify units if enabled
      try {
        const { data: notifySetting } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "jobs")
          .eq("key", "auto_notify_units_on_change")
          .maybeSingle();

        if (notifySetting?.value === true || notifySetting?.value === "true") {
          // Find all franchisees with unit_jobs linked to this job
          const { data: linkedUnits } = await supabase
            .from("unit_jobs")
            .select("unit_id")
            .eq("job_id", id);

          if (linkedUnits && linkedUnits.length > 0) {
            const unitIds = [...new Set(linkedUnits.map((u: any) => u.unit_id))];

            // Get franchisee user_ids for these units
            const { data: franchisees } = await supabase
              .rpc("get_admin_users");

            const recipientIds = (franchisees || [])
              .filter((f: any) => f.role === "franqueado" && unitIds.includes(f.unit_id))
              .map((f: any) => f.user_id);

            // Insert notifications
            const notifications = recipientIds.map((recipientId: string) => ({
              event_type: "cargo_alterado",
              recipient_id: recipientId,
              channel: "push",
              title: "Cargo atualizado",
              body: `O cargo "${data.title}" foi alterado. Verifique as novas configurações.`,
              status: "pending",
              payload: { job_id: id, version: nextVersion },
              action_url: "/admin/vagas",
              action_type: "info",
            }));

            if (notifications.length > 0) {
              await supabase.from("notifications").insert(notifications as any);
            }
          }
        }
      } catch (notifyErr) {
        console.warn("Falha ao notificar unidades:", notifyErr);
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job_versions"] });
    },
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      // Check linked unit_jobs
      const { count: ujCount, error: ujErr } = await supabase
        .from("unit_jobs")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId);
      if (ujErr) throw ujErr;
      if (ujCount && ujCount > 0) {
        throw new Error(`BLOCKED:Este cargo está vinculado a ${ujCount} vaga(s). Desative-o em vez de excluir.`);
      }

      // Check linked pipelines
      const { count: pipCount, error: pipErr } = await supabase
        .from("job_pipelines")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId);
      if (pipErr) throw pipErr;
      if (pipCount && pipCount > 0) {
        throw new Error(`BLOCKED:Este cargo possui ${pipCount} pipeline(s) vinculado(s). Remova-os antes de excluir.`);
      }

      // Preserve job_versions (histórico imutável) — dissociate instead of deleting
      await supabase.from("job_versions").update({ job_id: null } as any).eq("job_id", jobId);

      // Delete the job
      const { error } = await supabase.from("jobs").delete().eq("id", jobId);
      if (error) throw error;

      // Audit log
      const { data: userData } = await supabase.auth.getUser();
      supabase.from("activity_logs").insert({
        user_id: userData.user?.id ?? null,
        action: "cargo_excluido",
        module: "cargos",
        details: { job_id: jobId },
      } as any).then(() => {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job_versions"] });
    },
  });
}
