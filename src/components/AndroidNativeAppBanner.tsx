import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAndroidDevice, isPreviewOrIframe } from "@/lib/deviceDetect";
import { isNativeApp } from "@/lib/isNativeApp";

/**
 * AndroidNativeAppBanner
 *
 * Banner discreto exibido APENAS no navegador Android (web) para incentivar
 * o uso do aplicativo nativo (Play Store). No Android o fluxo PWA está
 * descontinuado; iOS não é afetado.
 *
 * - "Abrir aplicativo": tenta abrir o app nativo via intent URL. Se o app
 *   não estiver instalado, o próprio Chrome cai no `browser_fallback_url`
 *   (Google Play). Isso cobre os dois casos (instalado / não instalado)
 *   sem depender de detecção — que não é confiável na Web para Android.
 * - "Baixar na Google Play": link direto para a Play Store.
 */

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.example.recruta";
const ANDROID_PACKAGE = "com.example.recruta";
const DISMISS_KEY = "android_native_app_banner_dismissed";

function buildIntentUrl(): string {
  if (typeof window === "undefined") return PLAY_STORE_URL;
  const host = window.location.host;
  const pathAndQuery = window.location.pathname + window.location.search;
  // intent://<host><path>#Intent;scheme=https;package=<pkg>;S.browser_fallback_url=<playstore>;end
  return (
    `intent://${host}${pathAndQuery}` +
    `#Intent;scheme=https;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
  );
}

export function AndroidNativeAppBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isNativeApp()) return;
    if (isPreviewOrIframe()) return;
    if (!isAndroidDevice()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  const handleOpen = () => {
    const intentUrl = buildIntentUrl();
    // navigate away to trigger intent handler
    window.location.href = intentUrl;
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Aplicativo disponível para Android"
      className="fixed inset-x-0 bottom-0 z-[60] border-t bg-background/95 backdrop-blur px-3 py-2 shadow-lg"
      style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <Smartphone className="h-4 w-4 text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#3D2B1F] leading-tight">
            Temos um aplicativo para Android
          </p>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            Baixar na Google Play
          </a>
        </div>
        <Button
          size="sm"
          className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white"
          onClick={handleOpen}
        >
          Abrir aplicativo
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleDismiss}
          aria-label="Dispensar"
          title="Dispensar"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
