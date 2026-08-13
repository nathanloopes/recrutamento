import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIOSDevice, isPreviewOrIframe } from "@/lib/deviceDetect";
import { isNativeApp } from "@/lib/isNativeApp";

/**
 * IOSNativeAppBanner
 *
 * Espelho do AndroidNativeAppBanner para iOS. Aparece apenas em Safari iOS
 * (não-native, não-preview). O botão "Abrir aplicativo" navega para o link
 * da App Store; se o app nativo já estiver instalado, o iOS abre direto via
 * Universal Link, senão cai na loja.
 */

const APP_STORE_URL =
  "https://apps.apple.com/br/app/recruta/id000000000";
const APP_SCHEME_URL = "recruta://";
// Dispensa apenas da sessão atual: se o usuário fechar o Safari e voltar
// depois (ex.: desinstalou o app e reabriu o site), o banner reaparece.
const DISMISS_KEY = "ios_native_app_banner_dismissed_session";

export function IOSNativeAppBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isNativeApp()) return;
    if (isPreviewOrIframe()) return;
    if (!isIOSDevice()) return;
    try {
      // Limpa a chave antiga permanente (migra usuários que já haviam dispensado antes).
      localStorage.removeItem("ios_native_app_banner_dismissed");
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  const handleOpen = () => {
    // Estratégia iOS: tenta abrir o app instalado via custom scheme; se ele
    // não estiver instalado, o Safari mostra um alerta imediato ("Não é
    // possível abrir a página") e cancelaria o fallback. Por isso NÃO
    // observamos visibilitychange — confiamos no timeout puro:
    //  - App instalado: iOS troca de contexto, esta aba é congelada, o
    //    setTimeout não chega a rodar.
    //  - App não instalado: a página segue viva, o timeout dispara e
    //    redireciona para a App Store.
    window.setTimeout(() => {
      window.location.href = APP_STORE_URL;
    }, 1200);

    // Dispara o scheme via iframe oculto (não gera alerta se o scheme não
    // existir; a maioria das versões do iOS Safari suprime o erro).
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = APP_SCHEME_URL;
      document.body.appendChild(iframe);
      window.setTimeout(() => iframe.remove(), 1000);
    } catch {
      window.location.href = APP_SCHEME_URL;
    }
  };

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Aplicativo disponível para iPhone"
      className="fixed inset-x-0 bottom-0 z-[60] border-t bg-background/95 backdrop-blur px-3 py-2 shadow-lg"
      style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <Smartphone className="h-4 w-4 text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#3D2B1F] leading-tight">
            Temos um aplicativo para iPhone
          </p>
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            Baixar na App Store
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
