import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalida em batch todos os caches relacionados ao processo do candidato.
 * Garante que ao voltar para o dashboard a barra de status reflete a realidade
 * sem precisar de refresh manual (F5).
 */
export function invalidateProcessCache(qc: QueryClient) {
  const keys = [
    ["application_status"],
    ["my_applications"],
    ["candidate-stage"],
    ["triage"],
    ["my_test_assignments"],
    ["test_assignments"],
    ["test_assignment"],
    ["candidate_timeline"],
    ["talent_pool_entry"],
    ["talent_pool"],
    ["score_events"],
    ["candidate_test_status"],
  ];
  for (const k of keys) {
    qc.invalidateQueries({ queryKey: k });
  }
}
