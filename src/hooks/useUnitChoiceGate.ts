import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Gate de unidade (v6.2):
 * Retorna true quando o candidato já escolheu uma unidade para o cargo informado.
 * Sinais aceitos:
 *   1) `applications` ativa (status em_andamento/aprovado/contratado/standby) cujo
 *      `unit_jobs.job_id` corresponda ao cargo.
 *   2) `talent_invites.status = 'accepted'` cujo `unit_jobs.job_id` corresponda.
 *
 * Enquanto o gate não passar, fases do pipeline com `phase_kind != 'triagem'`
 * permanecem bloqueadas para o candidato.
 */
export function useUnitChoiceGate(jobId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["unit_choice_gate", user?.id, jobId],
    enabled: !!user?.id && !!jobId,
    staleTime: 15000,
    queryFn: async () => {
      // 1) Aplicação ativa para esse cargo
      const { data: apps, error: appsErr } = await supabase
        .from("applications")
        .select("id, status, unit_jobs!inner(job_id, unit_id)")
        .eq("candidate_id", user!.id)
        .in("status", ["pendente", "em_andamento", "em_avaliacao", "aprovado", "contratado", "standby"] as any);
      if (appsErr) throw appsErr;

      const matchingApp = (apps || []).find(
        (a: any) => a.unit_jobs?.job_id === jobId
      );
      if (matchingApp) {
        return {
          hasChosenUnit: true,
          source: "application" as const,
          applicationId: (matchingApp as any).id,
          unitId: (matchingApp as any).unit_jobs?.unit_id,
        };
      }

      // 2) Convite aceito para esse cargo
      const { data: invites, error: invErr } = await supabase
        .from("talent_invites")
        .select("id, status, unit_jobs!inner(job_id, unit_id)")
        .eq("candidate_id", user!.id)
        .eq("status", "accepted");
      if (invErr) throw invErr;

      const matchingInvite = (invites || []).find(
        (i: any) => i.unit_jobs?.job_id === jobId
      );
      if (matchingInvite) {
        return {
          hasChosenUnit: true,
          source: "invite" as const,
          inviteId: (matchingInvite as any).id,
          unitId: (matchingInvite as any).unit_jobs?.unit_id,
        };
      }

      return { hasChosenUnit: false, source: null as null };
    },
  });
}
