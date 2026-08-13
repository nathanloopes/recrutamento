/**
 * Utilities to detect a WebView/Capacitor environment and aggressively purge
 * all client-side storage so a logged-out session cannot be restored when the
 * user taps the CPF input on the next visit to /auth.
 *
 * Used exclusively by the WebView (mobile app). Web browsers continue with the
 * existing soft logout flow.
 */

// Deriva a chave de storage do supabase-js (`sb-<project-ref>-auth-token`) a
// partir da URL pública do projeto, evitando embutir o ref no código-fonte.
const SUPABASE_AUTH_KEY = (() => {
  const url =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
    "https://YOUR_PROJECT.supabase.co";
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "sb-YOUR_PROJECT-auth-token";
  }
})();
const IDENTITY_DEVICE_SEED_KEY = "identity.device_seed";

export function isWebView(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Capacitor injects window.Capacitor
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
      ReactNativeWebView?: { postMessage?: (msg: string) => void };
    };
    if (w.Capacitor?.isNativePlatform?.()) return true;
    if (w.Capacitor) return true;
    // react-native-webview (Expo iOS/Android shell)
    if (w.ReactNativeWebView?.postMessage) return true;

    const ua = window.navigator?.userAgent || "";
    // Android WebView marker
    if (/; wv\)/.test(ua)) return true;
    // Generic Android WebView
    if (/Android.*Version\/[\d.]+ Chrome\/[\d.]+ Mobile Safari/.test(ua) && /; wv\)/.test(ua)) return true;
    // iOS in-app WebView (no "Safari" token)
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    if (isIOS && !/Safari/.test(ua)) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Synchronously wipe every piece of client storage we can reach. Async APIs
 * (Cache Storage, IndexedDB) are kicked off but not awaited — the hard reload
 * that follows guarantees the next document starts clean either way.
 */
export function purgeAllClientStorage(): void {
  if (typeof window === "undefined") return;

  // 1) localStorage / sessionStorage — explicit keys first, then nuke
  //    BUT preserve `recruta_tour:<uuid>:completed` so re-login on the same
  //    auth.user.id never re-triggers the onboarding tour. Everything else
  //    (tokens, identity seed, tour step/visited/context) is wiped.
  const preservedTourKeys: Array<[string, string]> = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && /^recruta_tour:[^:]+:completed$/.test(key)) {
        const v = window.localStorage.getItem(key);
        if (v != null) preservedTourKeys.push([key, v]);
      }
    }
  } catch (error) {
    console.warn("[webviewCleanup] coleta de chaves do tour falhou:", error);
  }

  try {
    window.localStorage.removeItem(SUPABASE_AUTH_KEY);
    window.localStorage.removeItem(IDENTITY_DEVICE_SEED_KEY);
    window.localStorage.clear();
  } catch (error) {
    console.warn("[webviewCleanup] localStorage.clear falhou:", error);
  }

  // Restore tour completion markers — these are the single source of truth
  // for "this user already saw the onboarding" and MUST survive logout.
  try {
    for (const [k, v] of preservedTourKeys) {
      window.localStorage.setItem(k, v);
    }
  } catch (error) {
    console.warn("[webviewCleanup] restauração de chaves do tour falhou:", error);
  }

  try {
    window.sessionStorage.clear();
  } catch (error) {
    console.warn("[webviewCleanup] sessionStorage.clear falhou:", error);
  }

  // 2) Cookies do domínio (best-effort em todos os paths/domains plausíveis)
  try {
    const cookies = document.cookie ? document.cookie.split(";") : [];
    const hostname = window.location.hostname;
    const domains = new Set<string>([hostname, `.${hostname}`]);
    // Tenta também subir um nível (ex.: .example.com)
    const parts = hostname.split(".");
    if (parts.length > 2) {
      domains.add(`.${parts.slice(-2).join(".")}`);
    }
    const expired = "Thu, 01 Jan 1970 00:00:00 GMT";

    for (const raw of cookies) {
      const eq = raw.indexOf("=");
      const name = (eq > -1 ? raw.substring(0, eq) : raw).trim();
      if (!name) continue;
      // Sem domain
      document.cookie = `${name}=; expires=${expired}; path=/;`;
      for (const d of domains) {
        document.cookie = `${name}=; expires=${expired}; path=/; domain=${d};`;
      }
    }
  } catch (error) {
    console.warn("[webviewCleanup] limpeza de cookies falhou:", error);
  }

  // 3) Cache Storage (Service Worker / Workbox)
  try {
    if (typeof caches !== "undefined" && caches?.keys) {
      void caches.keys().then((keys) => {
        for (const key of keys) {
          void caches.delete(key);
        }
      });
    }
  } catch (error) {
    console.warn("[webviewCleanup] caches.delete falhou:", error);
  }

  // 4) IndexedDB
  try {
    const idb = window.indexedDB as IDBFactory & {
      databases?: () => Promise<{ name?: string }[]>;
    };
    if (idb?.databases) {
      void idb.databases().then((dbs) => {
        for (const db of dbs) {
          if (db?.name) {
            try { idb.deleteDatabase(db.name); } catch { /* noop */ }
          }
        }
      });
    }
  } catch (error) {
    console.warn("[webviewCleanup] indexedDB.databases falhou:", error);
  }
}

/**
 * Notifica o shell nativo (Expo / react-native-webview) de que um logout
 * acabou de ocorrer e que ele deve realizar uma purga nativa completa
 * (cookies do WKWebView, WKWebsiteDataStore, WKProcessPool, cache HTTP) e
 * remontar a WebView com `key` nova + `incognito={true}`.
 *
 * No-op se não estivermos dentro de um host react-native-webview.
 * Ver MOBILE_LOGOUT_FIX_IOS.md para o handler nativo correspondente.
 */
export function notifyNativeShellLogout(): void {
  if (typeof window === "undefined") return;
  try {
    const rn = (window as unknown as {
      ReactNativeWebView?: { postMessage?: (msg: string) => void };
    }).ReactNativeWebView;
    if (rn?.postMessage) {
      rn.postMessage(
        JSON.stringify({ type: "LOGOUT_PURGE_REQUEST", ts: Date.now() })
      );
    }
  } catch (error) {
    console.warn("[webviewCleanup] notifyNativeShellLogout falhou:", error);
  }
}
