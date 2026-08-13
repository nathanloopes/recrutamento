/**
 * Detecção de plataforma para fluxo de ativação de notificações.
 * Reaproveita lógica de webPush.ts e InstallPWAButton.tsx.
 */
import { isStandalonePWA } from "./webPush";
import { isNativeApp } from "./isNativeApp";

export type Platform =
  | "native-app"
  | "ios-pwa"
  | "ios-safari"
  | "android"
  | "desktop-chrome"
  | "desktop-firefox"
  | "desktop-edge"
  | "desktop-safari"
  | "other";

export function isPreviewOrIframe(): boolean {
  if (typeof window === "undefined") return false;
  let inIframe = false;
  try {
    inIframe = window.self !== window.top;
  } catch {
    inIframe = true;
  }
  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") || host.includes("lovableproject.com");
  return inIframe || isPreviewHost;
}

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ se identifica como Mac
  return navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;
}

export function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  if (isNativeApp()) return "native-app";
  const ua = navigator.userAgent || "";

  if (isIOSDevice()) {
    return isStandalonePWA() ? "ios-pwa" : "ios-safari";
  }

  if (isAndroidDevice()) return "android";

  // Desktop browsers
  const isEdge = /Edg\//i.test(ua);
  const isFirefox = /Firefox\//i.test(ua);
  const isChrome = /Chrome\//i.test(ua) && !isEdge;
  const isSafari = /Safari\//i.test(ua) && !isChrome && !isEdge;

  if (isEdge) return "desktop-edge";
  if (isFirefox) return "desktop-firefox";
  if (isChrome) return "desktop-chrome";
  if (isSafari) return "desktop-safari";
  return "other";
}

export function platformLabel(p: Platform): string {
  switch (p) {
    case "native-app": return "app nativo";
    case "ios-pwa": return "iPhone (app instalado)";
    case "ios-safari": return "iPhone (Safari)";
    case "android": return "Android";
    case "desktop-chrome": return "Chrome";
    case "desktop-firefox": return "Firefox";
    case "desktop-edge": return "Edge";
    case "desktop-safari": return "Safari";
    default: return "seu navegador";
  }
}
