/**
 * Filtros compartilhados para auditoria/monitoramento de notificações.
 *
 * "Erros esperados" são falhas que NÃO indicam degradação do canal:
 * destinatário sem push token, sem telefone, sem e-mail ou que optou
 * por não receber. Devem ser excluídos das métricas de entrega.
 */

export const SKIP_DELIVERY_ERRORS = new Set<string>([
  "no_push_tokens",
  "no_subscription",
  "no_phone",
  "no_email",
  "recipient_opted_out",
]);

export function getDeliveryLogError(log: any): string | null {
  const pr = log?.provider_response;
  if (!pr || typeof pr !== "object") return null;
  return (pr.error as string) || (pr.reason as string) || null;
}

/**
 * Retorna true quando o log é uma falha "esperada" (sem destino cadastrado
 * ou opt-out) e deve ser desconsiderado das métricas.
 */
export function isSkippedDeliveryLog(log: any): boolean {
  if (!log || log.delivered) return false;
  const err = getDeliveryLogError(log);
  return !!err && SKIP_DELIVERY_ERRORS.has(err);
}
