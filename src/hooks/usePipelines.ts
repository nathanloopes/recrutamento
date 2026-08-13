import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { incrementPipelineVersion, sendPipelineNotification } from "@/lib/pipelineEvents";

// ── RBAC Guard ──
// Verifies the current user has admin or rh_franqueadora role before mutations
async function assertPipelineEditor() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
  const { data: isRH } = await supabase.rpc("has_role", { _user_id: user.id, _role: "rh_franqueadora" });
  if (!isAdmin && !isRH) throw new Error("Sem permissão: apenas admin ou RH da franqueadora podem gerenciar pipelines");
  return user;
}

// ── CrossConfig enforcement helpers ──
async function getPipelineSetting(key: string, fallback: number): Promise<number> {
  try {
    const { data } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "pipelines")
      .eq("key", key)
      .maybeSingle();
    return data ? Number(data.value) : fallback;
  } catch {
    return fallback;
  }
}

// ── Check for active candidates in a pipeline ──
async function hasActiveCandidatesInPipeline(pipelineId: string): Promise<boolean> {
  const { data: phases } = await supabase
    .from("pipeline_phases")
    .select("id")
    .eq("pipeline_id", pipelineId);
  if (!phases || phases.length === 0) return false;
  const phaseIds = phases.map(p => p.id);
  const { count } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .in("current_phase", phaseIds)
    .eq("status", "em_andamento" as any);
  return (count || 0) > 0;
}

// ── Helpers ──

// Registra atividade no log (não bloqueia em caso de falha)
async function logActivity(action: string, details: Record<string, any>) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert({
      user_id: userData.user?.id || null,
      action,
      module: "pipelines",
      details,
    } as any);
  } catch (e) {
    console.error("[Pipelines] Falha ao registrar atividade:", e);
  }
}

// ── Queries ──

export function usePipelinesByJob(jobId: string | null) {
  return useQuery({
    queryKey: ["pipelines", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_pipelines")
        .select("*, pipeline_phases(*, pipeline_steps(*))")
        .eq("job_id", jobId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return data.map((p) => ({
        ...p,
        pipeline_phases: (p.pipeline_phases || [])
          .sort((a: any, b: any) => a.order_index - b.order_index)
          .map((ph: any) => ({
            ...ph,
            pipeline_steps: (ph.pipeline_steps || []).sort(
              (a: any, b: any) => a.order_index - b.order_index
            ),
          })),
      }));
    },
  });
}

// ── Pipeline CRUD ──

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: TablesInsert<"job_pipelines">) => {
      await assertPipelineEditor();
      // Single-active enforcement: deactivate others if creating as active
      if (p.is_active && p.job_id) {
        await supabase
          .from("job_pipelines")
          .update({ is_active: false } as any)
          .eq("job_id", p.job_id);
      }
      const { data, error } = await supabase.from("job_pipelines").insert(p).select().single();
      if (error) throw error;
      await logActivity("pipeline_criado", { pipeline_id: data.id, job_id: p.job_id, name: p.name });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

// ── Phase CRUD ──

export function useCreatePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: TablesInsert<"pipeline_phases">) => {
      await assertPipelineEditor();
      // Enforce max_pipeline_phases
      const maxPhases = await getPipelineSetting("max_pipeline_phases", 10);
      const { count } = await supabase
        .from("pipeline_phases")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_id", p.pipeline_id);
      if ((count || 0) >= maxPhases) {
        throw new Error(`Limite de ${maxPhases} fases por pipeline atingido`);
      }
      const { data, error } = await supabase.from("pipeline_phases").insert(p).select().single();
      if (error) throw error;
      await logActivity("fase_criada", { phase_id: data.id, pipeline_id: p.pipeline_id, name: p.name });
      await incrementPipelineVersion(p.pipeline_id);
      const { data: pipeline } = await supabase.from("job_pipelines").select("name").eq("id", p.pipeline_id).single();
      sendPipelineNotification("onPipelineVersionChange", { pipelineName: pipeline?.name || "" });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useUpdatePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<"pipeline_phases"> & { id: string }) => {
      await assertPipelineEditor();
      // Enforce allow_phase_edit_after_publish
      const allowEdit = await getPipelineSetting("allow_phase_edit_after_publish", 1);
      if (!allowEdit) {
        // Check if phase has active candidates
        const { count } = await supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("current_phase", id)
          .eq("status", "em_andamento" as any);
        if ((count || 0) > 0) {
          throw new Error("Edição bloqueada: fase possui candidatos em andamento e allow_phase_edit_after_publish está desativado");
        }
      }
      const { data, error } = await supabase.from("pipeline_phases").update(updates).eq("id", id).select().single();
      if (error) throw error;
      await logActivity("fase_editada", { phase_id: id, changes: updates });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useDeletePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, pipelineId }: { id: string; name?: string; pipelineId?: string }) => {
      await assertPipelineEditor();
      // Block deletion if candidates are active in this phase
      const { count } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("current_phase", id)
        .eq("status", "em_andamento" as any);
      if ((count || 0) > 0) {
        throw new Error("Não é possível excluir fase com candidatos em andamento");
      }
      // Regra: não permitir excluir a ÚLTIMA fase ativa de um pipeline ATIVO
      // (pipeline ativo precisa ter ao menos uma fase).
      if (pipelineId) {
        const { data: pipeline } = await supabase
          .from("job_pipelines")
          .select("is_active")
          .eq("id", pipelineId)
          .maybeSingle();
        if (pipeline?.is_active) {
          const { count: siblingActive } = await supabase
            .from("pipeline_phases")
            .select("id", { count: "exact", head: true })
            .eq("pipeline_id", pipelineId)
            .neq("id", id)
            .neq("is_active", false);
          if (!siblingActive || siblingActive === 0) {
            throw new Error("Não é possível excluir a última fase de um pipeline ativo. Desative o pipeline primeiro ou crie outra fase antes.");
          }
        }
      }
      // Limpa current_phase em candidatos terminais (histórico) — evita FK violation
      const { count: clearedCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("current_phase", id);
      await supabase
        .from("applications")
        .update({ current_phase: null } as any)
        .eq("current_phase", id);
      const { error } = await supabase.from("pipeline_phases").delete().eq("id", id);
      if (error) throw error;
      await logActivity("fase_excluida", { phase_id: id, name: name || "", cleared_applications: clearedCount || 0 });
      if (pipelineId) await incrementPipelineVersion(pipelineId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

// ── Step CRUD ──

export function useCreateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: TablesInsert<"pipeline_steps">) => {
      await assertPipelineEditor();
      // Enforce step_weight_limit
      const maxWeight = await getPipelineSetting("step_weight_limit", 10);
      if ((s.weight || 0) > maxWeight) {
        throw new Error(`Peso máximo por etapa é ${maxWeight}`);
      }
      const { data, error } = await supabase.from("pipeline_steps").insert(s).select().single();
      if (error) throw error;
      await logActivity("etapa_criada", { step_id: data.id, phase_id: s.phase_id, title: s.title, type: s.type });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useUpdateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<"pipeline_steps"> & { id: string }) => {
      await assertPipelineEditor();
      // Enforce step_weight_limit
      if (updates.weight !== undefined) {
        const maxWeight = await getPipelineSetting("step_weight_limit", 10);
        if (updates.weight > maxWeight) {
          throw new Error(`Peso máximo por etapa é ${maxWeight}`);
        }
      }
      // Enforce allow_phase_edit_after_publish for step edits
      const allowEdit = await getPipelineSetting("allow_phase_edit_after_publish", 1);
      if (!allowEdit) {
        // Get the phase for this step to check for active candidates
        const { data: step } = await supabase.from("pipeline_steps").select("phase_id").eq("id", id).single();
        if (step) {
          const { count } = await supabase
            .from("applications")
            .select("id", { count: "exact", head: true })
            .eq("current_phase", step.phase_id)
            .eq("status", "em_andamento" as any);
          if ((count || 0) > 0) {
            throw new Error("Edição bloqueada: fase possui candidatos em andamento e allow_phase_edit_after_publish está desativado");
          }
        }
      }
      const { data, error } = await supabase.from("pipeline_steps").update(updates).eq("id", id).select().single();
      if (error) throw error;
      await logActivity("etapa_editada", { step_id: id, changes: updates });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useDeleteStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title?: string }) => {
      await assertPipelineEditor();
      const { error } = await supabase.from("pipeline_steps").delete().eq("id", id);
      if (error) throw error;
      await logActivity("etapa_excluida", { step_id: id, title: title || "" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

// ── Toggle / Delete / Duplicate ──

export function useTogglePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active, jobId }: { id: string; is_active: boolean; jobId?: string }) => {
      await assertPipelineEditor();
      // Regra: pipeline ativo precisa ter ao menos uma fase ativa.
      if (is_active) {
        const { count: activePhaseCount } = await supabase
          .from("pipeline_phases")
          .select("id", { count: "exact", head: true })
          .eq("pipeline_id", id)
          .neq("is_active", false);
        if (!activePhaseCount || activePhaseCount === 0) {
          throw new Error("Pipeline ativo precisa ter ao menos uma fase. Adicione uma fase antes de ativar.");
        }
        // Single-active enforcement: desativa os demais do mesmo cargo.
        if (jobId) {
          await supabase
            .from("job_pipelines")
            .update({ is_active: false } as any)
            .eq("job_id", jobId)
            .neq("id", id);
        }
      }
      const { data, error } = await supabase.from("job_pipelines").update({ is_active } as any).eq("id", id).select().single();
      if (error) throw error;
      await logActivity("pipeline_toggle", { pipeline_id: id, is_active });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      await assertPipelineEditor();
      // Block deletion if candidates are active
      const hasCandidates = await hasActiveCandidatesInPipeline(id);
      if (hasCandidates) {
        throw new Error("Não é possível excluir pipeline com candidatos em andamento");
      }
      // Delete children first (steps → phases → pipeline) to avoid FK errors
      const { data: phases } = await supabase
        .from("pipeline_phases")
        .select("id")
        .eq("pipeline_id", id);
      let clearedApplications = 0;
      if (phases && phases.length > 0) {
        const phaseIds = phases.map(p => p.id);
        // Limpa current_phase em candidatos terminais apontando para qualquer fase deste pipeline
        const { count: clearedCount } = await supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .in("current_phase", phaseIds);
        clearedApplications = clearedCount || 0;
        await supabase
          .from("applications")
          .update({ current_phase: null } as any)
          .in("current_phase", phaseIds);
        const { error: stepErr } = await supabase
          .from("pipeline_steps")
          .delete()
          .in("phase_id", phaseIds);
        if (stepErr) throw stepErr;
        const { error: phaseErr } = await supabase
          .from("pipeline_phases")
          .delete()
          .eq("pipeline_id", id);
        if (phaseErr) throw phaseErr;
      }
      const { error } = await supabase.from("job_pipelines").delete().eq("id", id);
      if (error) throw error;
      await logActivity("pipeline_excluido", { pipeline_id: id, name: name || "", cleared_applications: clearedApplications });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useDuplicatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pipelineId, jobId }: { pipelineId: string; jobId: string }) => {
      await assertPipelineEditor();
      // Load original pipeline with phases and steps
      const { data: original, error: loadErr } = await supabase
        .from("job_pipelines")
        .select("*, pipeline_phases(*, pipeline_steps(*))")
        .eq("id", pipelineId)
        .single();
      if (loadErr || !original) throw loadErr || new Error("Pipeline not found");

      // Create new pipeline
      const { data: newPipeline, error: pErr } = await supabase
        .from("job_pipelines")
        .insert({ name: `${original.name} (cópia)`, job_id: jobId, is_active: false })
        .select()
        .single();
      if (pErr) throw pErr;

      // Duplicate phases and steps
      const phases = (original.pipeline_phases || []).sort((a: any, b: any) => a.order_index - b.order_index);
      for (const phase of phases) {
        const { data: newPhase, error: phErr } = await supabase
          .from("pipeline_phases")
          .insert({
            pipeline_id: newPipeline.id,
            name: phase.name,
            order_index: phase.order_index,
            min_score: phase.min_score,
            phase_type: (phase as any).phase_type,
            phase_kind: (phase as any).phase_kind,
            is_active: (phase as any).is_active,
          } as any)
          .select()
          .single();
        if (phErr) throw phErr;

        const steps = (phase.pipeline_steps || []).sort((a: any, b: any) => a.order_index - b.order_index);
        for (const step of steps) {
          await supabase.from("pipeline_steps").insert({
            phase_id: newPhase.id,
            title: step.title,
            type: step.type,
            weight: step.weight,
            content: step.content,
            order_index: step.order_index,
          });
        }
      }

      await logActivity("pipeline_duplicado", { original_id: pipelineId, new_id: newPipeline.id });
      return newPipeline;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

// ── Reorder ──

export function useReorderPhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ phases, phaseId, direction }: { phases: any[]; phaseId: string; direction: "up" | "down" }) => {
      const idx = phases.findIndex((p: any) => p.id === phaseId);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= phases.length) return;

      const a = phases[idx];
      const b = phases[swapIdx];

      await Promise.all([
        supabase.from("pipeline_phases").update({ order_index: b.order_index } as any).eq("id", a.id),
        supabase.from("pipeline_phases").update({ order_index: a.order_index } as any).eq("id", b.id),
      ]);
      await logActivity("fases_reordenadas", { pipeline_id: a.pipeline_id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}

export function useReorderStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ steps, stepId, direction }: { steps: any[]; stepId: string; direction: "up" | "down" }) => {
      const idx = steps.findIndex((s: any) => s.id === stepId);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= steps.length) return;

      const a = steps[idx];
      const b = steps[swapIdx];

      await Promise.all([
        supabase.from("pipeline_steps").update({ order_index: b.order_index } as any).eq("id", a.id),
        supabase.from("pipeline_steps").update({ order_index: a.order_index } as any).eq("id", b.id),
      ]);
      await logActivity("etapas_reordenadas", { phase_id: a.phase_id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
}
