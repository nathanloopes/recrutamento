import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Indica se o candidato logado já possui currículo cadastrado.
 * Considera `resume_versions` (verdade) e fallback em `candidate_profiles.resume_url`.
 */
export function useHasResume() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["has_resume", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data: versions } = await supabase
        .from("resume_versions")
        .select("id")
        .eq("candidate_id", user!.id)
        .limit(1);
      if ((versions || []).length > 0) return true;

      const { data: prof } = await supabase
        .from("candidate_profiles")
        .select("resume_url")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      return !!(prof as any)?.resume_url;
    },
  });
}
