import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hooks de acompanhamento da unidade usados pelo drawer "Acompanhamento da
 * Unidade" e pelo detalhe de Frequência (separados de useFranchiseePanel para
 * manter os arquivos enxutos). Ver [[useFranchiseePanel]].
 */

// ── Timeline: notas manuais datadas ──────────────────────────────────────────

export interface TimelineNote {
  id: string;
  unitId: string;
  note: string;
  noteDate: string; // YYYY-MM-DD
  createdBy: string | null;
  createdAt: string;
}

export function useUnitTimelineNotes(unitId: string | null) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const query = useQuery<TimelineNote[]>({
    queryKey: ["unit_timeline_notes", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("unit_timeline_notes")
        .select("id, unit_id, note, note_date, created_by, created_at")
        .eq("unit_id", unitId!)
        .order("note_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        id: r.id,
        unitId: r.unit_id,
        note: r.note,
        noteDate: r.note_date,
        createdBy: r.created_by ?? null,
        createdAt: r.created_at,
      }));
    },
  });

  const addNote = useMutation({
    mutationFn: async ({ note, noteDate }: { note: string; noteDate: string }) => {
      const { error } = await (supabase as any).from("unit_timeline_notes").insert({
        unit_id: unitId,
        note,
        note_date: noteDate,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["unit_timeline_notes", unitId] }),
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("unit_timeline_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["unit_timeline_notes", unitId] }),
  });

  return { notes: query.data || [], isLoading: query.isLoading, addNote, deleteNote };
}

// ── Timeline: eventos automáticos (derivados de dados reais) ──────────────────

export interface TimelineAutoEvent {
  key: string;
  label: string;
  date: string; // ISO
}

export function useUnitTimelineEvents(unitId: string | null) {
  return useQuery<TimelineAutoEvent[]>({
    queryKey: ["unit_timeline_events", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const events: TimelineAutoEvent[] = [];

      const { data: jobs } = await supabase
        .from("unit_jobs")
        .select("id, created_at")
        .eq("unit_id", unitId!)
        .order("created_at", { ascending: true });

      if (jobs && jobs.length) {
        events.push({ key: "primeira_vaga", label: "Primeira vaga criada", date: jobs[0].created_at });

        const jobIds = jobs.map((j: any) => j.id);
        let apps: any[] = [];
        {
          const B = 150;
          for (let i = 0; i < jobIds.length; i += B) {
            const { data } = await supabase
              .from("applications")
              .select("id, created_at, status")
              .in("unit_job_id", jobIds.slice(i, i + B));
            if (data) apps = apps.concat(data);
          }
        }

        if (apps.length) {
          apps.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
          events.push({ key: "primeiro_candidato", label: "Primeiro candidato inscrito", date: apps[0].created_at });

          const contratado = apps.find((a) => a.status === "contratado");
          if (contratado) {
            events.push({ key: "primeira_contratacao", label: "Primeira contratação", date: contratado.created_at });
          }

          // Primeira entrevista (batched para não estourar querystring)
          const appIds = apps.map((a) => a.id);
          let firstInterview: string | null = null;
          const B = 150;
          for (let i = 0; i < appIds.length; i += B) {
            const { data } = await supabase
              .from("interviews")
              .select("created_at")
              .in("application_id", appIds.slice(i, i + B))
              .order("created_at", { ascending: true })
              .limit(1);
            const d = data?.[0]?.created_at as string | undefined;
            if (d && (!firstInterview || Date.parse(d) < Date.parse(firstInterview))) firstInterview = d;
          }
          if (firstInterview) {
            events.push({ key: "primeira_entrevista", label: "Primeira entrevista", date: firstInterview });
          }
        }
      }

      return events;
    },
  });
}

// ── Frequência: histórico de ações do franqueado ─────────────────────────────

export const ACTION_LABELS: Record<string, string> = {
  erp_delegated_login: "Login realizado",
  erp_delegated_login_new_account: "Primeiro acesso (conta criada)",
  cargo_criado: "Criou vaga",
  vaga_corporativa_criada: "Criou vaga",
  vaga_corporativa_ativada_unidade: "Ativou vaga do catálogo",
  cargo_editado: "Editou vaga",
  cargo_excluido: "Excluiu vaga",
  vaga_corporativa_excluida: "Excluiu vaga",
  vaga_encerrada: "Encerrou vaga",
  vaga_preenchida: "Preencheu vaga",
  job_filled_auto_standby: "Vaga preenchida (automático)",
  candidatura_criada: "Nova candidatura recebida",
  candidatura_desistencia: "Candidato desistiu",
  candidato_reservado: "Reservou candidato",
  candidato_liberado: "Liberou candidato",
  candidate_paused: "Pausou candidato",
  entrevista_cancelled: "Cancelou entrevista",
  interview_finalized: "Finalizou entrevista",
  interview_decision_justified: "Justificou decisão de entrevista",
  contratacao_finalizada: "Contratou candidato",
  teste_cargo_concluido: "Concluiu teste de cargo",
  profile_update: "Atualizou o perfil",
  profile_updated: "Atualizou o perfil",
};

export function labelForAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const spaced = action.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface ActivityHistoryEntry {
  id: string;
  action: string;
  label: string;
  module: string | null;
  createdAt: string;
  userId: string | null;
}

/**
 * Histórico de ações dos franqueados da unidade (para o detalhe da coluna
 * "Frequência"). `enabled` evita buscar até o diálogo abrir.
 */
export function useUnitActivityHistory(userIds: string[], enabled: boolean) {
  return useQuery<ActivityHistoryEntry[]>({
    queryKey: ["unit_activity_history", [...userIds].sort()],
    enabled: enabled && userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, action, module, created_at, user_id")
        .in("user_id", userIds)
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        id: r.id,
        action: r.action,
        label: labelForAction(r.action),
        module: r.module ?? null,
        createdAt: r.created_at,
        userId: r.user_id ?? null,
      }));
    },
  });
}
