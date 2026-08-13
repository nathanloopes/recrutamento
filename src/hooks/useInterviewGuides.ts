import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// --- Interview Guides ---

export function useInterviewGuides(jobId?: string) {
  return useQuery({
    queryKey: ["interview_guides", jobId],
    queryFn: async () => {
      let q = supabase
        .from("interview_guides" as any)
        .select("*, jobs(id, title)")
        .eq("is_active", true)
        .order("version", { ascending: false });
      if (jobId) q = q.eq("job_id", jobId);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useAllInterviewGuides(jobId?: string) {
  return useQuery({
    queryKey: ["interview_guides_all", jobId],
    queryFn: async () => {
      let q = supabase
        .from("interview_guides" as any)
        .select("*, jobs(id, title)")
        .order("version", { ascending: false });
      if (jobId) q = q.eq("job_id", jobId);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useInterviewGuide(guideId?: string) {
  return useQuery({
    queryKey: ["interview_guide", guideId],
    enabled: !!guideId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interview_guides" as any)
        .select("*, jobs(id, title)")
        .eq("id", guideId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useGuideForJob(jobId?: string) {
  return useQuery({
    queryKey: ["interview_guide_for_job", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interview_guides" as any)
        .select("*")
        .eq("job_id", jobId!)
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useCreateGuide() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (guide: { job_id: string; guide_json: any; is_active?: boolean; version?: number }) => {
      const { data, error } = await supabase
        .from("interview_guides" as any)
        .insert({ ...guide, created_by: user?.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["interview_guides"] }),
  });
}

export function useUpdateGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; guide_json?: any; is_active?: boolean }) => {
      const { data, error } = await supabase
        .from("interview_guides" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["interview_guides"] }),
  });
}

export function useDeleteGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("interview_guides" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interview_guides"] });
      qc.invalidateQueries({ queryKey: ["interview_guides_all"] });
    },
  });
}

// --- Interview Feedback ---

export function useInterviewFeedback(interviewId?: string) {
  return useQuery({
    queryKey: ["interview_feedback", interviewId],
    enabled: !!interviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interview_feedback" as any)
        .select("*, interview_guides(id, guide_json, jobs(id, title))")
        .eq("interview_id", interviewId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (feedback: {
      interview_id: string;
      evaluator_id: string;
      guide_id?: string;
      checklist_json: any;
      decision: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase
        .from("interview_feedback" as any)
        .insert(feedback as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interview_feedback"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
    },
  });
}
