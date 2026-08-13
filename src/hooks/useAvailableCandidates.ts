import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hook para franqueados verem candidatos disponíveis e gerenciarem locks.
 */

export interface AvailableCandidate {
  candidate_id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  test_score: number;
  test_completed_at: string;
  distance_km: number;
  city: string;
  state: string;
}

// Busca candidatos aptos no raio da unidade do franqueado
export function useAvailableCandidates(unitId: string | undefined, jobId: string | undefined, radiusKm: number = 20) {
  return useQuery({
    queryKey: ["available_candidates", unitId, jobId, radiusKm],
    enabled: !!unitId && !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("available_candidates_in_radius", {
        p_unit_id: unitId!,
        p_job_id: jobId!,
        p_radius_km: radiusKm,
      });
      if (error) throw error;
      return (data || []) as AvailableCandidate[];
    },
  });
}

// Locks ativos do franqueado
export function useMyLocks(unitId: string | undefined) {
  return useQuery({
    queryKey: ["my_locks", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidate_locks")
        .select("*, profiles:candidate_id(id, full_name, email, phone, avatar_url, is_active), jobs:job_id(title)")
        .eq("unit_id", unitId!)
        .is("released_at", null)
        .order("locked_at", { ascending: false });
      if (error) throw error;
      // Esconder locks de candidatos desativados
      return (data || []).filter((l: any) => l.profiles?.is_active !== false);
    },
  });
}

// Criar lock (pegar candidato)
export function useLockCandidate() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      candidateId,
      unitId,
      jobId,
    }: {
      candidateId: string;
      unitId: string;
      jobId: string;
    }) => {
      if (!user) throw new Error("Não autenticado");

      const { data, error } = await supabase
        .from("candidate_locks")
        .insert({
          candidate_id: candidateId,
          unit_id: unitId,
          job_id: jobId,
          locked_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("Este candidato já está sendo avaliado por outra unidade.");
        }
        throw error;
      }

      // Log
      await supabase.from("activity_logs").insert({
        user_id: user.id,
        action: "candidato_reservado",
        module: "candidate_locks",
        details: { candidate_id: candidateId, unit_id: unitId, job_id: jobId },
      });

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["available_candidates"] });
      qc.invalidateQueries({ queryKey: ["my_locks"] });
    },
  });
}

// Liberar lock (rejeitar candidato → volta ao pool)
export function useReleaseLock() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lockId,
      reason,
    }: {
      lockId: string;
      reason: string;
    }) => {
      if (!user) throw new Error("Não autenticado");

      const { error } = await supabase
        .from("candidate_locks")
        .update({
          released_at: new Date().toISOString(),
          release_reason: reason,
        })
        .eq("id", lockId);

      if (error) throw error;

      // Log
      await supabase.from("activity_logs").insert({
        user_id: user.id,
        action: "candidato_liberado",
        module: "candidate_locks",
        details: { lock_id: lockId, reason },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["available_candidates"] });
      qc.invalidateQueries({ queryKey: ["my_locks"] });
    },
  });
}
