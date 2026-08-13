/**
 * formatName — apenas para EXIBIÇÃO.
 * Não use em payloads salvos no banco; o valor original do usuário é preservado.
 *
 * Regras:
 * - Trim e colapsa espaços.
 * - Converte para CAPS LOCK respeitando acentuação (locale pt-BR).
 * - Retorna `fallback` quando o nome estiver vazio/nulo.
 */
export function formatName(
  name?: string | null,
  fallback: string = "—",
): string {
  if (name == null) return fallback;
  const trimmed = String(name).replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  try {
    return trimmed.toLocaleUpperCase("pt-BR");
  } catch {
    return trimmed.toUpperCase();
  }
}

/** Iniciais em CAPS (até 2 letras), úteis para AvatarFallback. */
export function getInitials(name?: string | null, fallback = "?"): string {
  if (!name) return fallback;
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toLocaleUpperCase("pt-BR");
}
