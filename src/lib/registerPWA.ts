/**
 * Registra Service Worker mínimo para habilitar instalação PWA.
 *
 * Regras críticas:
 * - SÓ registra em produção (`import.meta.env.PROD`)
 * - SÓ registra fora de iframe (preview Lovable roda em iframe)
 * - SÓ registra fora de hosts de preview Lovable
 * - NUNCA registra em WebView Capacitor nativa (Android/iOS)
 * - Em preview/iframe/nativa: limpa SWs antigos para evitar cache poluído
 */
import { isNativeApp } from "./isNativeApp";

export function registerPWA() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") || host.includes("lovableproject.com");

  // Em nativa/preview/iframe: limpa qualquer SW que tenha sido registrado antes.
  if (isNativeApp() || isInIframe || isPreviewHost) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    }).catch(() => {});
    return;
  }

  // Só registra em produção real (build deployado).
  if (!import.meta.env.PROD) return;

  // Versão do SW — incrementar sempre que public/sw.js mudar.
  // Garante bypass de qualquer cache (Cloudflare / browser) sem depender
  // de purge manual: URL nova = cache miss = fetch direto do origin.
  const SW_VERSION = "7";

  window.addEventListener("load", () => {
    // Desregistra SWs antigos (URLs sem versão) antes de registrar o novo.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => {
        const url = r.active?.scriptURL || "";
        if (url && !url.includes(`v=${SW_VERSION}`)) {
          r.unregister().catch(() => {});
        }
      });
    }).catch(() => {});

    navigator.serviceWorker.register(`/sw.js?v=${SW_VERSION}`).catch((err) => {
      console.warn("[PWA] SW registration failed:", err);
    });
  });
}
