import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mic, Square, RotateCcw, CheckCircle2, AlertTriangle, Volume2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface VoiceQuestion {
  id: string;
  text: string;
  max_seconds: number;
  block?: string;
  weight?: number;
}

interface VoiceTestContent {
  questions: VoiceQuestion[];
  allow_repeat?: boolean;
  consent_text?: string;
}

interface Props {
  assignmentId: string;
  candidateId: string;
  template: {
    title: string;
    description?: string;
    content: VoiceTestContent;
  };
  onComplete: (audioUrls: Record<string, string>, questions: { id: string; text: string; weight?: number }[]) => void;
  isSubmitting: boolean;
}

type Phase = "consent" | "ready" | "recording" | "preview" | "uploading" | "done";

export function VoiceTestStep({ assignmentId, candidateId, template, onComplete, isSubmitting }: Props) {
  const [consented, setConsented] = useState(false);
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("consent");
  const [timeLeft, setTimeLeft] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [allAudioUrls, setAllAudioUrls] = useState<Record<string, string>>({});

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const questions = template.content?.questions || [];
  const currentQ = questions[currentQIdx];
  const allowRepeat = template.content?.allow_repeat ?? true;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, []);

  const cleanupRecordingResources = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setVolumeLevel(0);
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  const getSupportedMimeType = useCallback(() => {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/aac",
      "audio/ogg;codecs=opus",
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return undefined;
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Cleanup any previous recording resources
      cleanupRecordingResources();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioBlob(null);
      setAudioUrl(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Volume meter via AudioContext
      const audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setVolumeLevel(Math.min(100, (avg / 128) * 100));
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      // MediaRecorder with best supported mimeType
      const mimeType = getSupportedMimeType();
      const recorderOptions: MediaRecorderOptions = {};
      if (mimeType) recorderOptions.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, recorderOptions);
      const localChunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          localChunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        // Build blob from ALL collected chunks
        const finalMime = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(localChunks, { type: finalMime });

        if (blob.size === 0) {
          toast({ title: "Erro na gravação", description: "O áudio ficou vazio. Tente novamente.", variant: "destructive" });
          cleanupRecordingResources();
          setPhase("ready");
          return;
        }

        chunksRef.current = localChunks;
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setPhase("preview");

        // Cleanup recording resources but keep blob/url
        cleanupRecordingResources();
      };

      recorder.start(500);
      mediaRecorderRef.current = recorder;

      const maxSec = currentQ?.max_seconds || 120;
      setTimeLeft(maxSec);
      setPhase("recording");

      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            if (mediaRecorderRef.current?.state === "recording") {
              mediaRecorderRef.current.stop();
            }
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      toast({ title: "Erro", description: "Não foi possível acessar o microfone. Verifique as permissões do navegador.", variant: "destructive" });
    }
  }, [currentQ, cleanupRecordingResources, getSupportedMimeType, audioUrl]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const resetRecording = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setPhase("ready");
  }, [audioUrl]);

  const confirmAndUpload = useCallback(async () => {
    if (!audioBlob || !currentQ) return;
    setPhase("uploading");

    try {
      // Use correct extension based on actual blob type
      const isMP4 = audioBlob.type.includes("mp4") || audioBlob.type.includes("aac");
      const ext = isMP4 ? "mp4" : "webm";
      const contentType = audioBlob.type || "audio/webm";

      const filePath = `${candidateId}/test_${assignmentId}_${currentQ.id}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("voice-recordings")
        .upload(filePath, audioBlob, { contentType, upsert: true });

      if (uploadErr) throw uploadErr;

      // Store file path (not public URL) — bucket is private
      // The edge function will create signed URLs server-side
      const newUrls = { ...allAudioUrls, [currentQ.id]: filePath };
      setAllAudioUrls(newUrls);

      if (currentQIdx < questions.length - 1) {
        setCurrentQIdx(prev => prev + 1);
        setAudioBlob(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
        setPhase("ready");
        toast({ title: `Pergunta ${currentQIdx + 1} gravada!` });
      } else {
        setPhase("done");
        onComplete(newUrls, questions.map(q => ({ id: q.id, text: q.text, weight: q.weight })));
        toast({ title: "Todas as respostas foram gravadas!" });
      }
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
      setPhase("preview");
    }
  }, [audioBlob, currentQ, currentQIdx, questions, assignmentId, candidateId, allAudioUrls, audioUrl, onComplete]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!consented) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{template.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Consentimento para Gravação
            </div>
            <p className="text-sm text-muted-foreground">
              {template.content?.consent_text || "Ao iniciar, você autoriza a gravação de áudio para fins de avaliação. O áudio será armazenado de forma segura e utilizado exclusivamente no processo seletivo, conforme a LGPD."}
            </p>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>📋 {questions.length} pergunta(s) neste teste</p>
            <p>⏱️ Tempo máximo por resposta: {questions[0]?.max_seconds || 120}s</p>
            {allowRepeat && <p>🔄 Você poderá regravar cada resposta</p>}
          </div>
          {template.description && (
            <p className="text-sm text-muted-foreground">{template.description}</p>
          )}
          <Button onClick={() => { setConsented(true); setPhase("ready"); }} className="w-full">
            <Mic className="h-4 w-4 mr-2" />
            Concordo e quero iniciar
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "done") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          {isSubmitting ? (
            <>
              <Loader2 className="h-12 w-12 text-primary mx-auto animate-spin" />
              <h3 className="text-lg font-semibold">Processando avaliação...</h3>
              <p className="text-sm text-muted-foreground">A IA está transcrevendo e avaliando suas respostas. Aguarde.</p>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
              <h3 className="text-lg font-semibold">Teste de Voz Concluído</h3>
              <p className="text-sm text-muted-foreground">Suas respostas foram enviadas e avaliadas com sucesso.</p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{template.title}</CardTitle>
          <Badge variant="outline">
            {currentQIdx + 1} / {questions.length}
          </Badge>
        </div>
        <Progress value={((currentQIdx) / questions.length) * 100} className="h-1.5" />
      </CardHeader>
      <CardContent className="space-y-5">
        {currentQ && (
          <div className="space-y-2">
            {currentQ.block && (
              <Badge variant="secondary" className="text-[10px]">{currentQ.block}</Badge>
            )}
            <p className="text-base font-medium">{currentQ.text}</p>
          </div>
        )}

        {phase === "recording" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
                <span className="text-sm font-medium text-destructive">Gravando</span>
              </div>
              <span className="text-sm font-mono font-bold">{formatTime(timeLeft)}</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="h-3 w-3" />
                <span>Volume</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-75" style={{ width: `${volumeLevel}%` }} />
              </div>
            </div>
            <Button onClick={stopRecording} variant="destructive" className="w-full">
              <Square className="h-4 w-4 mr-2" />
              Parar Gravação
            </Button>
          </div>
        )}

        {phase === "ready" && (
          <Button onClick={startRecording} className="w-full">
            <Mic className="h-4 w-4 mr-2" />
            Iniciar Gravação
          </Button>
        )}

        {phase === "preview" && audioUrl && (
          <div className="space-y-3">
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-xs text-muted-foreground mb-2">Ouça sua resposta:</p>
              <audio src={audioUrl} controls className="w-full" />
            </div>
            <div className="flex gap-2">
              {allowRepeat && (
                <Button variant="outline" onClick={resetRecording} className="flex-1">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Regravar
                </Button>
              )}
              <Button onClick={confirmAndUpload} className="flex-1">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {currentQIdx < questions.length - 1 ? "Confirmar e Próxima" : "Confirmar e Finalizar"}
              </Button>
            </div>
          </div>
        )}

        {phase === "uploading" && (
          <div className="flex items-center justify-center py-4 gap-2">
            <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            <span className="text-sm text-muted-foreground">Enviando áudio...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
