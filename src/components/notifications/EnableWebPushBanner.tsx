import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  isWebPushSupported,
  getCurrentSubscription,
  subscribeToPush,
  isIOS,
} from "@/lib/webPush";
import { isNativeApp } from "@/lib/isNativeApp";

const DISMISS_KEY = "web_push_dismissed";
const IOS_DISMISS_KEY = "ios_notify_app_dismissed";
const APP_STORE_URL =
  "https://apps.apple.com/br/app/recruta/id000000000";
const APP_SCHEME_URL = "recruta://";

type Mode = "hidden" | "enable" | "ios-app";

export function EnableWebPushBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("hidden");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      if (isNativeApp()) return setMode("hidden");
      if (!user) return setMode("hidden");

      // iOS Safari: notificações web só funcionam em PWA instalado (política
      // Apple). Como o PWA foi descontinuado, direcionamos para o app nativo.
      if (isIOS()) {
        if (localStorage.getItem(IOS_DISMISS_KEY) === "1") return setMode("hidden");
        return setMode("ios-app");
      }

      if (localStorage.getItem(DISMISS_KEY) === "1") return setMode("hidden");
      if (!isWebPushSupported()) return setMode("hidden");
      if (Notification.permission === "denied") return setMode("hidden");

      const sub = await getCurrentSubscription();
      if (cancelled) return;
      if (sub) return setMode("hidden");

      setMode("enable");
    }

    evaluate();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleDismiss = () => {
    localStorage.setItem(mode === "ios-app" ? IOS_DISMISS_KEY : DISMISS_KEY, "1");
    setMode("hidden");
  };

  const handleEnable = async () => {
    setLoading(true);
    try {
      await subscribeToPush();
      toast({
        title: "Notificações ativadas",
        description: "Você receberá alertas mesmo com o app fechado.",
      });
      setMode("hidden");
    } catch (e) {
      toast({
        title: "Não foi possível ativar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenApp = () => {
    // Fallback puro por timeout — se o scheme abrir o app, a página é
    // congelada e o setTimeout nunca dispara. Se não abrir, vai para a loja.
    window.setTimeout(() => {
      window.location.href = APP_STORE_URL;
    }, 1200);
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

  if (mode === "hidden") return null;

  if (mode === "ios-app") {
    return (
      <div className="border-b bg-accent/40 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 shrink-0 text-primary" />
          <p className="flex-1 text-foreground/90 leading-tight">
            Para receber notificações no iPhone, instale nosso aplicativo.
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" onClick={handleOpenApp}>
              Instalar app
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleDismiss}
              title="Dispensar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b bg-accent/40 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 shrink-0 text-primary" />
        <p className="flex-1 text-foreground/90 leading-tight">
          Ative as notificações para receber novidades em tempo real.
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" onClick={handleEnable} disabled={loading}>
            {loading ? "Ativando..." : "Ativar"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleDismiss}
            title="Dispensar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
