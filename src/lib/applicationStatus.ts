/**
 * Status de candidatura que bloqueiam o acesso ao fluxo de descoberta de vaga
 * (chat RoleSelection em /oportunidades).
 *
 * `apto_para_vaga` NÃO bloqueia — é justamente quando o candidato precisa
 * entrar no fluxo para escolher unidade.
 *
 * Status terminais/inativos (standby, reprovado, pausado, desistiu) liberam
 * o acesso para que o candidato possa buscar nova oportunidade.
 *
 * `aprovado` bloqueia apenas quando a candidatura já tem uma unidade vinculada.
 * Se a candidatura está aprovada na triagem mas ainda não tem unidade, o
 * candidato precisa escolher a unidade antes de agendar a entrevista.
 */
export const BLOCKS_JOB_DISCOVERY = new Set<string>([
  "pendente",
  "em_andamento",
  "em_avaliacao",
  "aprovado",
  "contratado",
]);

export function hasActiveApplicationBlockingDiscovery(timeline: any): boolean {
  const status = timeline?.application?.status;
  if (!status || !BLOCKS_JOB_DISCOVERY.has(status)) return false;
  // Aprovado sem unidade vinculada: ainda precisa escolher a vaga, então
  // mantém o acesso à descoberta liberado.
  if (status === "aprovado") {
    const hasUnit = !!timeline?.application?.unit_jobs?.unit_id || !!timeline?.application?.unit_jobs?.units?.id;
    return hasUnit;
  }
  return true;
}
