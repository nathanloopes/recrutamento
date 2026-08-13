/**
 * Resolve para onde o usuário deve ir após login/cadastro bem-sucedido.
 *
 * Retorna o caminho alvo APENAS quando há override explícito:
 *  1. ?next=/caminho da URL atual (apenas paths internos começando com "/")
 *  2. sessionStorage OU localStorage "pending_origin_link_token" → /v/<token>
 *
 * O mirror em localStorage existe para sobreviver à reabertura do PWA
 * standalone (sessionStorage é descartado no novo contexto de navegação).
 */
import { getOriginDeeplinkPath } from "./originDeeplink";
export const ORIGIN_LINK_STORAGE_KEY = "pending_origin_link_token";
const ORIGIN_LINK_AT_KEY = "pending_origin_link_token_at";
const ORIGIN_LINK_TTL_MS = 30 * 60 * 1000; // 30 min

function readLocalToken(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const value = localStorage.getItem(ORIGIN_LINK_STORAGE_KEY);
    if (!value) return null;
    const ts = Number(localStorage.getItem(ORIGIN_LINK_AT_KEY) ?? 0);
    if (ts && Date.now() - ts > ORIGIN_LINK_TTL_MS) {
      localStorage.removeItem(ORIGIN_LINK_STORAGE_KEY);
      localStorage.removeItem(ORIGIN_LINK_AT_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function setPendingOriginLinkToken(token: string): void {
  if (!token) return;
  try {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(ORIGIN_LINK_STORAGE_KEY, token);
    localStorage.setItem(ORIGIN_LINK_STORAGE_KEY, token);
    localStorage.setItem(ORIGIN_LINK_AT_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

// ---- Camada explícita "veio de convite" (sobrevive reinício do PWA) ----
export const INSTALL_REDIRECT_KEY = "install_redirect_after_signup";
export const CAME_FROM_INVITE_KEY = "came_from_invite";

export function markInviteContext(href?: string): void {
  try {
    if (typeof window === "undefined") return;
    const url = href ?? window.location.href;
    if (!url) return;
    localStorage.setItem(INSTALL_REDIRECT_KEY, url);
    localStorage.setItem(CAME_FROM_INVITE_KEY, "true");
    localStorage.setItem(ORIGIN_LINK_AT_KEY, String(Date.now()));
  } catch { /* noop */ }
}

export function cameFromInvite(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(CAME_FROM_INVITE_KEY) === "true";
  } catch { return false; }
}

export function getInstallRedirectPath(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(INSTALL_REDIRECT_KEY);
    if (!raw) return null;
    const ts = Number(localStorage.getItem(ORIGIN_LINK_AT_KEY) ?? 0);
    if (ts && Date.now() - ts > ORIGIN_LINK_TTL_MS) {
      clearInviteContext();
      return null;
    }
    let path = raw;
    try {
      const u = new URL(raw, window.location.origin);
      if (u.origin !== window.location.origin) return null;
      path = u.pathname + u.search + u.hash;
    } catch { /* already a path */ }
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    return path;
  } catch { return null; }
}

export function clearInviteContext(): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.removeItem(INSTALL_REDIRECT_KEY);
    localStorage.removeItem(CAME_FROM_INVITE_KEY);
  } catch { /* noop */ }
}

export function resolvePostAuthRedirect(search?: string): string | null {
  try {
    const sp = new URLSearchParams(search ?? (typeof window !== "undefined" ? window.location.search : ""));
    const next = sp.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      return next;
    }
  } catch { /* noop */ }
  // Prioridade máxima: origin_deeplink (captura silenciosa de link de divulgação)
  try {
    const path = getOriginDeeplinkPath();
    if (path) return path;
  } catch { /* noop */ }
  // Prioridade: contexto explícito "veio de convite"
  const installPath = getInstallRedirectPath();
  if (installPath) return installPath;
  try {
    const sessionToken =
      typeof window !== "undefined" ? sessionStorage.getItem(ORIGIN_LINK_STORAGE_KEY) : null;
    const token = sessionToken ?? readLocalToken();
    if (token) return `/v/${token}`;
  } catch { /* noop */ }
  return null;
}

export function clearPendingOriginLinkToken(): void {
  try {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(ORIGIN_LINK_STORAGE_KEY);
      localStorage.removeItem(ORIGIN_LINK_STORAGE_KEY);
      localStorage.removeItem(ORIGIN_LINK_AT_KEY);
    }
  } catch { /* noop */ }
  clearInviteContext();
}

export function getPendingOriginLinkToken(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const sessionToken = sessionStorage.getItem(ORIGIN_LINK_STORAGE_KEY);
    if (sessionToken) return sessionToken;
    return readLocalToken();
  } catch {
    return null;
  }
}
