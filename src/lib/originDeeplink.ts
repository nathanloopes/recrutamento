/**
 * Origin Deeplink — captura silenciosa do link de divulgação.
 *
 * Objetivo único: preservar a URL original quando o usuário entra pelo link de
 * divulgação (/v/:token, /u/:slug/:slug/:short, ou URL com utm_, ref, campaign),
 * para que, após instalação do PWA + login/cadastro/onboarding, ele retorne
 * exatamente ao fluxo original em vez de ser jogado em /oportunidades.
 *
 * Não altera UX, não altera modal PWA, não altera onboarding.
 * Roda passivamente no boot do app.
 */

const KEY = "origin_deeplink";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24h

function isDeeplinkPath(pathname: string, search: string): boolean {
  if (pathname.startsWith("/v/") || pathname.startsWith("/u/")) return true;
  if (!search) return false;
  const sp = new URLSearchParams(search);
  for (const k of sp.keys()) {
    if (k.startsWith("utm_")) return true;
    if (k === "ref" || k === "campaign" || k === "token") return true;
  }
  return false;
}

function setCookie(value: string): void {
  try {
    document.cookie = `${KEY}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch { /* ignore */ }
}

function readCookie(): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${KEY}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

function clearCookie(): void {
  try {
    document.cookie = `${KEY}=; path=/; Max-Age=0; SameSite=Lax`;
  } catch { /* ignore */ }
}

/** Captura silenciosa — roda no boot, antes de qualquer login/instalação. */
export function captureOriginDeeplinkFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const { pathname, search, origin } = window.location;

    // Caso especial: /auth?next=/<path> vindo do convite WhatsApp do PWA.
    // Precisamos persistir o `next` ANTES da instalação, pois quando o PWA
    // reabre em start_url=/?source=pwa o querystring é perdido.
    try {
      const sp = new URLSearchParams(search);
      const next = sp.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        const absolute = origin + next;
        try { localStorage.setItem(KEY, absolute); } catch { /* ignore */ }
        try { sessionStorage.setItem(KEY, absolute); } catch { /* ignore */ }
        setCookie(absolute);
        // Também marca "veio de convite" para o PwaInstallController consumir
        // após a instalação do PWA.
        try {
          // import dinâmico evita ciclo
          void import("./postAuthRedirect").then((m) => m.markInviteContext(absolute));
        } catch { /* ignore */ }
        return;
      }
    } catch { /* ignore */ }

    if (!isDeeplinkPath(pathname, search)) return;
    const href = window.location.href;
    try { localStorage.setItem(KEY, href); } catch { /* ignore */ }
    try { sessionStorage.setItem(KEY, href); } catch { /* ignore */ }
    setCookie(href);
  } catch { /* ignore */ }
}

/** Lê o deeplink salvo (localStorage > sessionStorage > cookie). */
export function getOriginDeeplink(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = localStorage.getItem(KEY);
    if (ls) return ls;
  } catch { /* ignore */ }
  try {
    const ss = sessionStorage.getItem(KEY);
    if (ss) return ss;
  } catch { /* ignore */ }
  return readCookie();
}

/** Retorna o path interno (sem origin) se o deeplink for do mesmo host. */
export function getOriginDeeplinkPath(): string | null {
  const raw = getOriginDeeplink();
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    const path = u.pathname + u.search + u.hash;
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    return path;
  } catch {
    return null;
  }
}

export function clearOriginDeeplink(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  clearCookie();
}
