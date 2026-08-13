import { useEffect, useState, useMemo } from "react";
import { Bell, Settings, AlertCircle, FlaskConical } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { subscribeToPush, getCurrentSubscription } from "@/lib/webPush";
import { detectPlatform, isPreviewOrIframe, type Platform } from "@/lib/deviceDetect";
import { isNativeApp } from "@/lib/isNativeApp";

interface Props {
  firstName: string;
  onEnabled: () => void;
  onSkip: () => void;
}

export function EnableNotificationsStep({ firstName, onEnabled, onSkip }: Props) {
  const native = useMemo(() => isNativeApp(), []);
  const platform = useMemo<Platform>(() => detectPlatform(), []);

  const isPreview = useMemo(() => isPreviewOrIframe(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (native) onSkip();
  }, [native, onSkip]);

  if (native) return null;

  const handleEnable = async () => {
    setLoading(true);
    setError(null);
    try {
      // Se já estava inscrito, considera ok
      const existing = await getCurrentSubscription();
      if (existing) {
        onEnabled();
        return;
      }
      await subscribeToPush();
      onEnabled();
    } catch (e) {
      setAttempts((a) => a + 1);
      setError(
        e instanceof Error
          ? e.message
          : "Não consegui ativar. Tenta de novo?"
      );
    } finally {
      setLoading(false);
    }
  };

  const showSkip = attempts >= 2;

  return (
    <Card className="border-0 shadow-md w-full max-w-md">
      <CardContent className="p-6 sm:p-8 space-y-5">
        <div className="flex justify-center">
          <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
            <Bell className="h-8 w-8 text-amber-600" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-display font-bold text-[#3D2B1F]">
            Oi{firstName ? `, ${firstName}` : ""} 👋
          </h1>
          <p className="text-sm text-foreground leading-relaxed">
            Deixa eu te explicar uma coisa importante.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pra gente se comunicar por aqui — horários de entrevista, novidades das
            vagas, mensagens — eu vou precisar te enviar notificações pelo seu
            aparelho. Bora ativar juntos? 💛
          </p>
        </div>

        {isPreview ? (
          <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-[#3D2B1F] flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-amber-600" />
              Modo preview
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              As notificações só funcionam de verdade quando o app é aberto fora
              do editor (publicado ou instalado). Por enquanto pode seguir.
            </p>
          </div>
        ) : (
          <PlatformInstructions platform={platform} />
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isPreview ? (
          <Button
            size="lg"
            className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            onClick={onSkip}
          >
            Continuar
          </Button>
        ) : platform === "ios-safari" ? (
          <div className="space-y-2">
            <Button
              size="lg"
              className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              onClick={onSkip}
            >
              Continuar
            </Button>
          </div>
        ) : (
          <>
            <Button
              size="lg"
              className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              onClick={handleEnable}
              disabled={loading}
            >
              <Bell className="h-4 w-4 mr-2" />
              {loading
                ? "Ativando..."
                : attempts > 0
                  ? "Tentar de novo"
                  : "Ativar notificações"}
            </Button>

            {showSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="w-full text-xs text-muted-foreground underline hover:text-foreground transition-colors"
              >
                Pular por enquanto
              </button>
            )}
          </>
        )}

      </CardContent>
    </Card>
  );
}

function PlatformInstructions({ platform }: { platform: Platform }) {
  if (platform === "ios-safari") {
    return (
      <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-[#3D2B1F]">
          📱 No iPhone, as notificações podem variar conforme o ambiente.
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Se o aviso não aparecer agora, pode continuar normalmente. A gente te avisa dentro do portal.
        </p>
      </div>
    );
  }


  if (platform === "ios-pwa") {
    return (
      <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
        <p className="font-semibold text-[#3D2B1F]">📱 No iPhone:</p>
        <p className="text-muted-foreground">
          Quando aparecer o aviso, toca em <strong>Permitir</strong> pra eu poder te
          mandar notificações.
        </p>
      </div>
    );
  }

  if (platform === "android") {
    return (
      <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
        <p className="font-semibold text-[#3D2B1F]">🤖 No Android:</p>
        <p className="text-muted-foreground">
          Quando aparecer o aviso, toca em <strong>Permitir</strong>. Pronto, é
          só isso!
        </p>
      </div>
    );
  }

  if (platform === "desktop-safari") {
    return (
      <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
        <p className="font-semibold text-[#3D2B1F]">
          <Settings className="inline h-4 w-4 mr-1" /> No Safari:
        </p>
        <p className="text-muted-foreground">
          Se não aparecer o aviso, vai em <strong>Safari → Ajustes → Sites → Notificações</strong>{" "}
          e libera pra esse site.
        </p>
      </div>
    );
  }

  // chrome / edge / firefox / other
  return (
    <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
      <p className="font-semibold text-[#3D2B1F]">💻 No navegador:</p>
      <p className="text-muted-foreground">
        Vai aparecer um aviso pedindo permissão. Toca em{" "}
        <strong>Permitir</strong> pra ativar.
      </p>
    </div>
  );
}



