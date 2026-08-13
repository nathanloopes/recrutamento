// Session freshness helpers.
//
// Uploads of large files over slow networks can outlive the JWT lifetime.
// If the token expires between the `storage.upload()` and the subsequent
// database INSERT, the write fails with an RLS violation and the storage
// object becomes orphaned. These helpers make sure the JWT is fresh before
// each sensitive step and recover once if it expired in-flight.
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export class SessionExpiredError extends Error {
  constructor(message = "Sua sessão expirou. Faça login novamente e tente enviar o documento outra vez.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

function secondsUntilExpiry(session: Session | null): number {
  if (!session?.expires_at) return 0;
  return session.expires_at - Math.floor(Date.now() / 1000);
}

/**
 * Guarantees an authenticated session whose JWT is valid for at least
 * `minTtlSeconds` more seconds. Refreshes proactively when the remaining
 * TTL is under the threshold. Throws `SessionExpiredError` when no session
 * exists or when a refresh cannot be completed.
 */
export async function ensureFreshSession(opts: { minTtlSeconds?: number } = {}): Promise<Session> {
  const minTtl = opts.minTtlSeconds ?? 120;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new SessionExpiredError();

  if (secondsUntilExpiry(session) >= minTtl) return session;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed?.session) {
    throw new SessionExpiredError();
  }
  return refreshed.session;
}

/**
 * Returns true when a PostgREST/Supabase error looks like the caller's JWT
 * expired or the RLS insert failed because `auth.uid()` was null at the
 * moment the row was written.
 */
export function isAuthOrRlsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as any;
  const status = Number(anyErr.status ?? anyErr.statusCode);
  const code = String(anyErr.code ?? "");
  const message = String(anyErr.message ?? "").toLowerCase();
  if (status === 401 || status === 403) return true;
  // Postgres SQLSTATE for insufficient privilege / RLS violation.
  if (code === "42501") return true;
  // supabase-js / PostgREST tag for expired or missing JWT.
  if (code === "PGRST301" || code === "PGRST303") return true;
  if (message.includes("jwt") && (message.includes("expired") || message.includes("invalid") || message.includes("missing"))) return true;
  if (message.includes("row-level security") || message.includes("row level security")) return true;
  return false;
}
