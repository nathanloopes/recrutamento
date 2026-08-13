import { Capacitor } from "@capacitor/core";

/**
 * Fonte única de verdade para detectar se o app está rodando dentro do
 * shell nativo (Capacitor Android/iOS ou react-native-webview).
 *
 * Cenários cobertos:
 *  1. Bridge Capacitor injetado (`window.Capacitor.isNativePlatform()`).
 *  2. Protocolo `capacitor:` (iOS sem custom scheme alterado).
 *  3. `window.ReactNativeWebView` (RN WebView).
 *  4. User-Agent marcado com `CapacitorNativeApp` (configurado em
 *     `capacitor.config.ts` via `appendUserAgent`) — funciona mesmo quando o
 *     app navega para uma origem remota onde o bridge JS não está disponível.
 *  5. WKWebView do iOS (`window.webkit.messageHandlers`) combinado com UA
 *     Mobile/Safari sem "Safari/" (heurística clássica de WebView iOS).
 *  6. Android WebView padrão (`; wv)` no UA).
 *  7. Override manual: `localStorage.setItem('force_native_app','1')` ou
 *     `?native=1` / `?app=nativo` / `?capacitor=1` na URL.
 */
const STORAGE_KEY = "force_native_app";

function persistNativeFlag() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
  try { document.documentElement.dataset.nativeApp = "true"; } catch { /* ignore */ }
}

function readOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const nativeParam = params.get("native") ?? params.get("nativeApp") ?? params.get("app_nativo");
    const appParam = params.get("app") ?? params.get("platform") ?? params.get("source");
    const capacitorParam = params.get("capacitor");

    if (
      nativeParam === "1" ||
      capacitorParam === "1" ||
      appParam === "native" ||
      appParam === "nativo" ||
      appParam === "native_app" ||
      appParam === "capacitor"
    ) {
      persistNativeFlag();
      return true;
    }
    if (nativeParam === "0" || appParam === "web") {
      window.localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return window.localStorage.getItem(STORAGE_KEY) === "1" ? true : null;
  } catch {
    return null;
  }
}

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const override = readOverride();
    if (override !== null) return override;

    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
      ReactNativeWebView?: { postMessage?: (msg: string) => void };
      webkit?: { messageHandlers?: Record<string, unknown> };
    };

    const corePlatform = Capacitor.getPlatform?.();
    if (Capacitor.isNativePlatform?.() === true || (corePlatform && corePlatform !== "web")) {
      persistNativeFlag();
      return true;
    }

    if (w.Capacitor?.isNativePlatform?.() === true || w.Capacitor?.getPlatform?.() !== undefined && w.Capacitor.getPlatform() !== "web") {
      persistNativeFlag();
      return true;
    }
    if (window.location.protocol === "capacitor:" || window.location.protocol === "ionic:") {
      persistNativeFlag();
      return true;
    }
    if (w.ReactNativeWebView?.postMessage) {
      persistNativeFlag();
      return true;
    }

    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";

    // Marcador injetado pelo shell Capacitor (vide capacitor.config.ts)
    if (/CapacitorNativeApp|Capacitor|RecrutaNative|RecrutaBotNative|com.example.recruta/i.test(ua)) {
      persistNativeFlag();
      return true;
    }

    // Android WebView padrão
    if (/; wv[;) ]/i.test(ua) || /\bVersion\/\d+\.\d+\s+Chrome\/.*\s+Mobile\s+Safari\//i.test(ua)) {
      persistNativeFlag();
      return true;
    }

    // iOS WKWebView (Capacitor/qualquer outro shell): tem messageHandlers e
    // UA sem "Safari/" embora contenha "Mobile/".
    const isIOSLike = /iPhone|iPad|iPod/.test(ua);
    const hasMessageHandlers = !!w.webkit?.messageHandlers;
    const hasCapacitorHandler = !!(
      w.webkit?.messageHandlers?.bridge ||
      w.webkit?.messageHandlers?.capacitor ||
      w.webkit?.messageHandlers?.cordova
    );
    const looksLikeWebView = /Mobile\//.test(ua) && (!/Safari\//.test(ua) || hasCapacitorHandler);
    if (isIOSLike && hasMessageHandlers && looksLikeWebView) {
      persistNativeFlag();
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
