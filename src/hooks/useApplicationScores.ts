import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ApplicationScore {
  applicationId: string;
  jobTitle: string;
  unitName: string;
  totalScore: number;
  status: string;
  updatedAt: string;
}

export function useApplicationScores(candidateId?: string) {
  const { user } = useAuth();
  const id = candidateId || user?.id;

  return useQuery({
    queryKey: ["application_scores", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, total_score, status, updated_at, unit_jobs(jobs(title), units(name))")
        .eq("candidate_id", id!)
        .gt("total_score", 0)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        applicationId: row.id,
        jobTitle: row.unit_jobs?.jobs?.title ?? "Vaga",
        unitName: row.unit_jobs?.units?.name ?? "",
        totalScore: Number(row.total_score) || 0,
        status: row.status,
        updatedAt: row.updated_at,
      })) as ApplicationScore[];
    },
  });
}

const STATUS_LABELS: Record<string, string> = {
  em_andamento: "Em andamento",
  aprovado: "Aprovado",
  standby: "Standby",
  on_hold: "Standby",
  encerrado: "Encerrado",
  desligado: "Encerrado",
  desistente: "Desistente",
  contratado: "Contratado",
};

export function labelForApplicationStatus(status: string): string {
  return STATUS_LABELS[status] || status;
}
