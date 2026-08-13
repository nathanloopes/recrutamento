import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mic, Square, RotateCcw, CheckCircle2, AlertTriangle, Volume2 } from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";

interface VoiceQuestion {
  id: string;
  text: string;
  max_seconds: number;
  block?: string;
}

interface VoiceInterviewContent {
  questions: VoiceQuestion[];
  allow_repeat_question?: boolean;
  consent_text?: string;
}

interface Props {
  title: string;
  content: VoiceInterviewContent;
  stepId: string;
  applicationId: string;
  onSubmit: (response: any, score?: number) => void;
  isSubmitting: boolean;
}

type Phase = "consent" | "recording" | "preview" | "submitting" | "done";

export function VoiceInterviewStep({ title, content, stepId, applicationId, onSubmit, isSubmitting }: Props) {
  const [consented, setConsented] = useState(false);
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("consent");
  const [timeLeft, setTimeLeft] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [allAnswers, setAllAnswers] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const questions = content.questions || [];
  const currentQ = questions[currentQIdx];
  const allowRepeat = content.allow_repeat_question ?? true;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Volume analyser
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setVolumeLevel(Math.min(100, (avg / 128) * 100));
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      // MediaRecorder — detectar codec suportado (iOS não suporta webm)
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "",
      ].find((t) => t === "" || MediaRecorder.isTypeSupported(t)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setPhase("preview");
        stream.getTracks().forEach(t => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setVolumeLevel(0);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;

      // Timer
      const maxSec = currentQ?.max_seconds || 120;
      setTimeLeft(maxSec);
      setPhase("recording");

      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            recorder.stop();
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      toast.error("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  }, [currentQ]);

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
    setPhase("consent"); // back to ready state for this question
    setConsented(true); // skip consent since already consented
  }, [audioUrl]);

  const confirmAndUpload = useCallback(async () => {
    if (!audioBlob || !currentQ) return;
    setIsUploading(true);
    setPhase("submitting");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      const filePath = `${user.id}/${stepId}_${currentQ.id}.webm`;
      const { error: uploadErr } = await supabase.storage
        .from("voice-recordings")
        .upload(filePath, audioBlob, { contentType: "audio/webm", upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from("voice-recordings")
        .getPublicUrl(filePath);

      const newAnswers = { ...allAnswers, [currentQ.id]: urlData.publicUrl };
      setAllAnswers(newAnswers);

      // If more questions, advance
      if (currentQIdx < questions.length - 1) {
        setCurrentQIdx(prev => prev + 1);
        setAudioBlob(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
        setPhase("consent");
        setConsented(true);
        toast.success(`Pergunta ${currentQIdx + 1} gravada!`);
      } else {
        // All done - submit all answers and trigger transcription
        setPhase("done");
        const responsePayload = {
          type: "entrevista_voz",
          audio_urls: newAnswers,
          questions: questions.map(q => ({ id: q.id, text: q.text })),
        };

        // Call transcribe-audio edge function (mock)
        try {
          const { data: { session } } = await supabase.auth.getSession();
          await fetch(
            `${SUPABASE_URL}/functions/v1/transcribe-audio`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session?.access_token}`,
                apikey: SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                application_id: applicationId,
                step_id: stepId,
                audio_urls: newAnswers,
                questions: questions.map(q => ({ id: q.id, text: q.text })),
              }),
            }
          );
        } catch {
          // Non-blocking - transcription is async
        }

        onSubmit(responsePayload);
        toast.success("Entrevista por voz concluída!");
      }
    } catch (err) {
      safeToast.error(err);
      setPhase("preview");
    } finally {
      setIsUploading(false);
    }
  }, [audioBlob, currentQ, currentQIdx, questions, stepId, applicationId, allAnswers, audioUrl, onSubmit]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Consent screen
  if (!consented) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Consentimento para Gravação
            </div>
            <p className="text-sm text-muted-foreground">
              {content.consent_text || "Ao iniciar, você autoriza a gravação de áudio para fins de avaliação. O áudio será armazenado de forma segura e utilizado exclusivamente no processo seletivo."}
            </p>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>📋 {questions.length} pergunta(s) nesta entrevista</p>
            <p>⏱️ Tempo máximo por resposta: {questions[0]?.max_seconds || 120}s</p>
            {allowRepeat && <p>🔄 Você poderá regravar cada resposta</p>}
          </div>
          <Button onClick={() => { setConsented(true); }} className="w-full">
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
          <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
          <h3 className="text-lg font-semibold">Entrevista Concluída</h3>
          <p className="text-sm text-muted-foreground">Suas respostas foram enviadas. A avaliação será processada em instantes.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Badge variant="outline">
            {currentQIdx + 1} / {questions.length}
          </Badge>
        </div>
        <Progress value={((currentQIdx) / questions.length) * 100} className="h-1.5" />
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Question */}
        {currentQ && (
          <div className="space-y-2">
            {currentQ.block && (
              <Badge variant="secondary" className="text-[10px]">{currentQ.block}</Badge>
            )}
            <p className="text-base font-medium">{currentQ.text}</p>
          </div>
        )}

        {/* Recording state */}
        {phase === "recording" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
                <span className="text-sm font-medium text-destructive">Gravando</span>
              </div>
              <span className="text-sm font-mono font-bold">{formatTime(timeLeft)}</span>
            </div>

            {/* Volume bar */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="h-3 w-3" />
                <span>Volume</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-75"
                  style={{ width: `${volumeLevel}%` }}
                />
              </div>
            </div>

            <Button onClick={stopRecording} variant="destructive" className="w-full">
              <Square className="h-4 w-4 mr-2" />
              Parar Gravação
            </Button>
          </div>
        )}

        {/* Ready to record */}
        {(phase === "consent" && consented) && (
          <Button onClick={startRecording} className="w-full">
            <Mic className="h-4 w-4 mr-2" />
            Iniciar Gravação
          </Button>
        )}

        {/* Preview */}
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
              <Button
                onClick={confirmAndUpload}
                disabled={isUploading || isSubmitting}
                className="flex-1"
              >
                {isUploading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                {currentQIdx < questions.length - 1 ? "Confirmar e Próxima" : "Confirmar e Finalizar"}
              </Button>
            </div>
          </div>
        )}

        {/* Submitting */}
        {phase === "submitting" && (
          <div className="flex items-center justify-center py-4 gap-2">
            <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            <span className="text-sm text-muted-foreground">Enviando áudio...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
