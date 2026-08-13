import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// --- Test Guides (Roteiro de Teste) ---
// Tabela `test_guides` é totalmente independente de `interview_guides`.

export function useAllTestGuides(jobId?: string) {
  return useQuery({
    queryKey: ["test_guides_all", jobId],
    queryFn: async () => {
      let q = supabase
        .from("test_guides" as any)
        .select("*, jobs(id, title)")
        .order("created_at", { ascending: false });
      if (jobId) q = q.eq("job_id", jobId);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useCreateTestGuide() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (guide: { job_id: string; guide_json: any; is_active?: boolean; version?: number }) => {
      // Evita duplicidade de roteiro ativo por cargo: se o novo entra ativo,
      // desativa os demais ativos do mesmo job_id antes de inserir.
      if (guide.is_active !== false) {
        await supabase
          .from("test_guides" as any)
          .update({ is_active: false } as any)
          .eq("job_id", guide.job_id)
          .eq("is_active", true);
      }
      const { data, error } = await supabase
        .from("test_guides" as any)
        .insert({ ...guide, created_by: user?.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_guides_all"] });
    },
  });
}

export function useUpdateTestGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; guide_json?: any; is_active?: boolean }) => {
      // Ao ATIVAR um roteiro, desativa os demais ativos do mesmo cargo
      // (mantém apenas um ativo por job_id).
      if (updates.is_active === true) {
        const { data: cur } = await supabase
          .from("test_guides" as any)
          .select("job_id")
          .eq("id", id)
          .maybeSingle();
        const jobId = (cur as any)?.job_id;
        if (jobId) {
          await supabase
            .from("test_guides" as any)
            .update({ is_active: false } as any)
            .eq("job_id", jobId)
            .eq("is_active", true)
            .neq("id", id);
        }
      }
      const { data, error } = await supabase
        .from("test_guides" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_guides_all"] });
    },
  });
}

export function useDeleteTestGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("test_guides" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_guides_all"] });
    },
  });
}
