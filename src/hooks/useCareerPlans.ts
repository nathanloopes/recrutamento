import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCareerPlans(unitId?: string, jobId?: string) {
  return useQuery({
    queryKey: ["career_plans", unitId, jobId],
    queryFn: async () => {
      let q = supabase
        .from("career_plans")
        .select("*, units(id, name, city, state), jobs(id, title)")
        .order("name", { ascending: true });
      if (unitId) q = q.eq("unit_id", unitId);
      if (jobId) q = q.eq("job_id", jobId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).slice().sort((a: any, b: any) =>
        String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );
    },
  });
}

export function useCareerPlanForUnitJob(unitId?: string, jobId?: string) {
  return useQuery({
    queryKey: ["career_plan_for", unitId, jobId],
    enabled: !!unitId && !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("career_plans")
        .select("*")
        .eq("unit_id", unitId!)
        .eq("job_id", jobId!)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCareerPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan: { unit_id: string; job_id: string; levels: any[]; is_active?: boolean }) => {
      const { data, error } = await supabase
        .from("career_plans")
        .insert(plan as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["career_plans"] }),
  });
}

export function useUpdateCareerPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; levels?: any[]; is_active?: boolean }) => {
      const { data, error } = await supabase
        .from("career_plans")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["career_plans"] });
      qc.invalidateQueries({ queryKey: ["career_plan_for"] });
    },
  });
}
