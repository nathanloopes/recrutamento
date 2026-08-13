import { supabase } from "@/integrations/supabase/client";

export type RestartMode =
  | "triagem"
  | "teste"
  | "entrevista"
  | "documentacao"
  | "last_valid";

export const RESTART_MODE_LABELS: Record<RestartMode, string> = {
  triagem: "Recomeçar do zero (Triagem)",
  teste: "Voltar para Teste",
  entrevista: "Voltar para Entrevista",
  documentacao: "Voltar para Documentação",
  last_valid: "Última etapa válida antes da reprovação",
};

/**
 * Reinicia o ciclo de uma candidatura: fecha o ciclo atual com snapshot,
 * apaga interviews/tests/step_responses/document_requests, recoloca a
 * application na fase escolhida e abre um novo ciclo. Histórico fica
 * preservado em `application_cycles`.
 */
export async function restartApplicationCycle(
  applicationId: string,
  mode: RestartMode,
  actorUserId?: string,
): Promise<{ new_cycle: number; restart_phase_id: string | null; mode: RestartMode }> {
  let actor = actorUserId;
  if (!actor) {
    const { data } = await supabase.auth.getUser();
    actor = data.user?.id;
  }
  const { data, error } = await supabase.rpc("restart_application_cycle" as any, {
    p_application_id: applicationId,
    p_mode: mode,
    p_actor: actor ?? null,
  });
  if (error) throw error;
  return data as any;
}
