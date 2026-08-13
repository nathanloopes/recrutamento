import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { toast } from "@/hooks/use-toast";
import { Upload, Video, Mic, Camera, Loader2, RotateCcw, CheckCircle2, Square, Play } from "lucide-react";
import { NativeFileInput, type NativeFileInputHandle } from "@/components/ui/NativeFileInput";

type MediaMode = "video" | "audio" | "imagem";

interface MediaAnswerInputProps {
  mode: MediaMode;
  maxSeconds?: number;
  value?: string;
  onChange: (path: string) => void;
  assignmentId: string;
  candidateId: string;
  questionIndex: number;
}

const MAX_FILE_MB = 50;

const acceptMap: Record<MediaMode, string> = {
  video: "video/*",
  audio: "audio/*",
  imagem: "image/*",
};

const labelMap: Record<MediaMode, { capture: string; icon: any; ext: string; mime: string }> = {
  video: { capture: "Gravar vídeo", icon: Video, ext: "webm", mime: "video/webm" },
  audio: { capture: "Gravar áudio", icon: Mic, ext: "webm", mime: "audio/webm" },
  imagem: { capture: "Tirar foto", icon: Camera, ext: "jpg", mime: "image/jpeg" },
};

export function MediaAnswerInput({
  mode,
  maxSeconds = 120,
  value,
  onChange,
  assignmentId,
  candidateId,
  questionIndex,
}: MediaAnswerInputProps) {
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);

  const { capture: captureLabel, icon: CaptureIcon, ext, mime } = labelMap[mode];

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const uploadBlob = async (blob: Blob, filename: string) => {
    if (blob.size > MAX_FILE_MB * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: `Máximo ${MAX_FILE_MB} MB`, variant: "destructive" });
      return;
    }
    setUploading(true);
    const path = `tests/${candidateId}/${assignmentId}/q${questionIndex}_${Date.now()}_${filename}`;
    const storage = await getStorageClient();
    const { error } = await storage.storage.from("documents").upload(path, blob, {
      upsert: true,
      contentType: blob.type || mime,
    });
    setUploading(false);
    if (error) {
      toast({ title: "Erro no upload", description: error.message, variant: "destructive" });
      return;
    }
    onChange(path);
    toast({ title: "Resposta enviada" });
  };

  const handleFileSelect = async (e: { target: { files: FileList | null; value: string } }) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadBlob(file, file.name);
  };

  const uploadInputRef = useRef<NativeFileInputHandle>(null);
  const captureInputRef = useRef<NativeFileInputHandle>(null);

  const startRecording = async () => {
    try {
      const constraints: MediaStreamConstraints =
        mode === "video"
          ? { video: { facingMode: "user" }, audio: true }
          : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (mode === "video" && liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.play().catch(() => {});
      }

      const mr = new MediaRecorder(stream);
      recorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (ev) => ev.data.size > 0 && chunksRef.current.push(ev.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        setRecordedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stopStream();
      };
      mr.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((s) => {
          if (s + 1 >= maxSeconds) {
            stopRecording();
            return maxSeconds;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: any) {
      toast({
        title: "Permissão negada",
        description: "Não foi possível acessar câmera/microfone. " + (err?.message || ""),
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current?.state === "recording" && recorderRef.current?.stop();
    setRecording(false);
  };

  const confirmRecording = async () => {
    if (!recordedBlob) return;
    await uploadBlob(recordedBlob, `recorded.${ext}`);
    setRecordedBlob(null);
    setPreviewUrl(null);
  };

  const resetRecording = () => {
    setRecordedBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setElapsed(0);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (value) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" />
          <span>Resposta enviada</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => onChange("")}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Refazer
        </Button>
      </div>
    );
  }

  return (
    <Tabs defaultValue="upload" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="upload">
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          Anexar arquivo
        </TabsTrigger>
        <TabsTrigger value="record">
          <CaptureIcon className="h-3.5 w-3.5 mr-1.5" />
          {captureLabel}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className="pt-3">
        <NativeFileInput
          ref={uploadInputRef}
          accept={acceptMap[mode]}
          disabled={uploading}
          onChange={handleFileSelect}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={uploading}
          onClick={() => uploadInputRef.current?.open()}
        >
          <Upload className="h-4 w-4 mr-2" />
          {uploading ? "Enviando..." : "Selecionar arquivo"}
        </Button>
        {uploading && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Enviando...
          </div>
        )}
      </TabsContent>

      <TabsContent value="record" className="pt-3 space-y-3">
        {mode === "imagem" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Use a câmera do dispositivo:</p>
            <NativeFileInput
              ref={captureInputRef}
              accept="image/*"
              disabled={uploading}
              onChange={handleFileSelect}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={uploading}
              onClick={() => captureInputRef.current?.open()}
            >
              <Camera className="h-4 w-4 mr-2" />
              {uploading ? "Enviando..." : "Tirar foto / Escolher imagem"}
            </Button>
          </div>
        ) : (
          <>
            {mode === "video" && (
              <video
                ref={liveVideoRef}
                muted
                playsInline
                className="w-full rounded-lg bg-black aspect-video"
              />
            )}

            {previewUrl && !recording && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Pré-visualização:</p>
                {mode === "video" ? (
                  <video src={previewUrl} controls playsInline className="w-full rounded-lg" />
                ) : (
                  <audio src={previewUrl} controls className="w-full" />
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-mono">
                {formatTime(elapsed)} / {formatTime(maxSeconds)}
              </span>

              <div className="flex gap-2">
                {!recording && !recordedBlob && (
                  <Button size="sm" onClick={startRecording} disabled={uploading}>
                    <CaptureIcon className="h-4 w-4 mr-1" />
                    Iniciar
                  </Button>
                )}
                {recording && (
                  <Button size="sm" variant="destructive" onClick={stopRecording}>
                    <Square className="h-4 w-4 mr-1" />
                    Parar
                  </Button>
                )}
                {recordedBlob && !recording && (
                  <>
                    <Button size="sm" variant="outline" onClick={resetRecording} disabled={uploading}>
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Refazer
                    </Button>
                    <Button size="sm" onClick={confirmRecording} disabled={uploading}>
                      {uploading ? (
                        <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Enviando...</>
                      ) : (
                        <><CheckCircle2 className="h-4 w-4 mr-1" /> Enviar</>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
