import { useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { LocalVideoTrack, Track } from "livekit-client";
import { BackgroundProcessor } from "@livekit/track-processors";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Botão flutuante que liga/desliga o desfoque de fundo na câmera local.
 * Cada participante controla apenas o próprio vídeo.
 */
export function BackgroundBlurToggle() {
  const { localParticipant } = useLocalParticipant();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const processorRef = useRef<ReturnType<typeof BackgroundProcessor> | null>(null);

  const getCameraTrack = (): LocalVideoTrack | undefined => {
    const pub = localParticipant?.getTrackPublication(Track.Source.Camera);
    return pub?.track as LocalVideoTrack | undefined;
  };

  const toggle = async () => {
    const track = getCameraTrack();
    if (!track) {
      toast.error("Ligue a câmera para aplicar o desfoque.");
      return;
    }
    setBusy(true);
    try {
      if (!enabled) {
        // MediaPipe self-hospedado (mesma origem) para não depender de CDN
        // (cdn.jsdelivr.net / storage.googleapis.com) — ver CSP e
        // tools/copy-mediapipe-wasm.mjs. Os assets são servidos de /mediapipe.
        const processor = BackgroundProcessor({
          mode: "background-blur",
          blurRadius: 15,
          assetPaths: {
            tasksVisionFileSet: "/mediapipe/wasm",
            modelAssetPath: "/mediapipe/selfie_segmenter.tflite",
          },
        });
        await track.setProcessor(processor);
        processorRef.current = processor;
        setEnabled(true);
      } else {
        await track.stopProcessor();
        processorRef.current = null;
        setEnabled(false);
      }
    } catch (e: any) {
      console.error("BackgroundBlur error", e);
      toast.error(
        e?.message ||
          "Este dispositivo não suporta desfoque de fundo. Tente um navegador atualizado em desktop.",
      );
    } finally {
      setBusy(false);
    }
  };

  // Garante limpeza ao desmontar / trocar de câmera
  useEffect(() => {
    return () => {
      const track = getCameraTrack();
      if (track && processorRef.current) {
        track.stopProcessor().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Button
      size="sm"
      variant={enabled ? "default" : "secondary"}
      onClick={toggle}
      disabled={busy}
      className="fixed left-2 z-50 shadow-lg text-xs sm:text-sm"
      style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      title={enabled ? "Desativar desfoque" : "Desfocar fundo"}
    >
      {busy ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="mr-1.5 h-4 w-4" />
      )}
      {enabled ? "Desfoque ativo" : "Desfocar fundo"}
    </Button>
  );
}
