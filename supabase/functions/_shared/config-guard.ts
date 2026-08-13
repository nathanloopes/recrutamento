/**
 * configGuard — leitura cacheada de global_settings + helpers de enforcement.
 *
 * Princípios:
 * - Fail-open em leituras (transitório não pode bloquear o sistema).
 * - Fail-closed em ações sensíveis (override de score, rollback, env_lock).
 * - Cache em memória por 60s para reduzir custo de leituras repetidas.
 *
 * Lê chaves auditadas como órfãs/parciais na Fase 1:
 *   security/session_timeout_minutes
 *   security/enable_ai_audit
 *   security/anomaly_detection_enabled
 *   security/anomaly_threshold
 *   security/require_override_reason
 *   audit/environment_lock
 *   audit/rollback_enabled
 *   notifications/notifications_enabled
 */
import { createAdminClient } from "./cors.ts";

type SettingValue = unknown;

interface CacheEntry {
  value: SettingValue;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(category: string, key: string): string {
  return `${category}::${key}`;
}

/**
 * Lê uma chave de global_settings com cache de 60s.
 * Nunca lança — retorna fallback em qualquer erro (fail-open).
 */
export async function getSetting<T = SettingValue>(
  category: string,
  key: string,
  fallback: T,
): Promise<T> {
  const ck = cacheKey(category, key);
  const now = Date.now();
  const hit = cache.get(ck);
  if (hit && hit.expiresAt > now) {
    return (hit.value as T) ?? fallback;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("global_settings")
      .select("value")
      .eq("category", category)
      .eq("key", key)
      .maybeSingle();

    if (error) {
      console.warn(`[configGuard] read error ${ck}:`, error.message);
      return fallback;
    }

    const value = data?.value ?? fallback;
    cache.set(ck, { value, expiresAt: now + CACHE_TTL_MS });
    return (value as T) ?? fallback;
  } catch (err) {
    console.warn(`[configGuard] exception ${ck}:`, err);
    return fallback;
  }
}

/** Coerção robusta para boolean (true/"true"/1/"1"). */
export function toBool(v: unknown, fallback = false): boolean {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return fallback;
}

/** Coerção robusta para number. */
export function toNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------------------------------------------ */
/*                     Helpers de alto nível                           */
/* ------------------------------------------------------------------ */

/**
 * Kill switch global de notificações.
 * Quando notifications/notifications_enabled === false, qualquer Edge Function
 * de envio deve abortar antes do passo 1 do motor de 9 passos.
 */
export async function notificationsEnabled(): Promise<boolean> {
  const v = await getSetting("notifications", "notifications_enabled", true);
  return toBool(v, true);
}

/**
 * Exige justificativa em mutations sensíveis quando
 * security/require_override_reason = true.
 * Lança Response 400 se o reason for vazio.
 */
export async function assertOverrideReason(reason: string | null | undefined): Promise<void> {
  const required = toBool(
    await getSetting("security", "require_override_reason", false),
    false,
  );
  if (!required) return;
  if (!reason || !reason.trim()) {
    throw new Response(
      JSON.stringify({
        error: "override_reason_required",
        message: "Justificativa obrigatória para esta ação.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Bloqueia alterações críticas em produção quando audit/environment_lock = true.
 * @param category categoria da setting sendo alterada
 * @returns null se permitido, Response 423 se bloqueado
 */
export async function assertEnvironmentUnlocked(
  category: string,
): Promise<Response | null> {
  const locked = toBool(
    await getSetting("audit", "environment_lock", false),
    false,
  );
  if (!locked) return null;
  // Categorias críticas — sincronizado com plano de remediação Fase 2
  const critical = new Set(["security", "audit", "migration", "feature_control"]);
  if (!critical.has(category)) return null;
  return new Response(
    JSON.stringify({
      error: "environment_locked",
      message:
        "Ambiente bloqueado para alterações críticas. Desative o Environment Lock em Configurações → Auditoria.",
    }),
    { status: 423, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Verifica se o registro de decisões da IA está habilitado
 * (security/enable_ai_audit). Default: true.
 */
export async function aiAuditEnabled(): Promise<boolean> {
  return toBool(await getSetting("security", "enable_ai_audit", true), true);
}

/**
 * Configuração de detecção de anomalias.
 */
export async function getAnomalyConfig(): Promise<{
  enabled: boolean;
  threshold: number;
}> {
  const enabled = toBool(
    await getSetting("security", "anomaly_detection_enabled", true),
    true,
  );
  const threshold = toNumber(
    await getSetting("security", "anomaly_threshold", 5),
    5,
  );
  return { enabled, threshold };
}

/**
 * Tempo (em minutos) de inatividade antes de considerar a sessão expirada.
 */
export async function getSessionTimeoutMinutes(): Promise<number> {
  return toNumber(
    await getSetting("security", "session_timeout_minutes", 60),
    60,
  );
}

/** Limpa o cache (uso apenas em testes). */
export function __resetConfigGuardCache(): void {
  cache.clear();
}
