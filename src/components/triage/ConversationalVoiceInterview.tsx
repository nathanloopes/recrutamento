import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mic, Square, RotateCcw, CheckCircle2, AlertTriangle, Volume2, MessageSquare, Bot, Loader2 } from "lucide-react";
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
  job_title?: string;
}

interface Props {
  title: string;
  content: VoiceInterviewContent;
  stepId: string;
  applicationId: string;
  onSubmit: (response: any, score?: number) => void;
  isSubmitting: boolean;
}

interface TurnResult {
  question: string;
  answer: string;
  score: number;
  feedback: string;
  decision: "continue" | "repeat" | "end";
}

type Phase = "consent" | "ready" | "recording" | "analyzing" | "feedback" | "done";

export function VoiceInterviewStep({ title, content, stepId, applicationId, onSubmit, isSubmitting }: Props) {
  const [consented, setConsented] = useState(false);
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("consent");
  const [timeLeft, setTimeLeft] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [turns, setTurns] = useState<TurnResult[]>([]);
  const [currentFeedback, setCurrentFeedback] = useState<{ score: number; feedback: string; decision: string } | null>(null);
  const [repeatCount, setRepeatCount] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const questions = content.questions || [];
  const currentQ = questions[currentQIdx];
  const maxRepeats = 1; // Máximo de repetições por pergunta

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

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
        stream.getTracks().forEach(t => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setVolumeLevel(0);
        // Auto-analyze after recording stops
        handleAnalyze(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;

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
    } catch {
      toast.error("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  }, [currentQ]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleAnalyze = useCallback(async (blob: Blob) => {
    if (!currentQ) return;
    setPhase("analyzing");
    setIsAnalyzing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      // Upload audio
      const filePath = `${user.id}/${stepId}_${currentQ.id}_t${turns.length}.webm`;
      const { error: uploadErr } = await supabase.storage
        .from("voice-recordings")
        .upload(filePath, blob, { contentType: "audio/webm", upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from("voice-recordings")
        .getPublicUrl(filePath);

      // Call AI evaluation
      const { data: session } = await supabase.auth.getSession();
      const baseUrl = SUPABASE_URL;
      const anonKey = SUPABASE_ANON_KEY;

      const response = await fetch(`${baseUrl}/functions/v1/voice-interview-turn`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token}`,
          apikey: anonKey,
        },
        body: JSON.stringify({
          audio_url: urlData.publicUrl,
          question_id: currentQ.id,
          question_text: currentQ.text,
          step_id: stepId,
          job_title: content.job_title || "",
          turn_index: currentQIdx,
          total_questions: questions.length,
          previous_turns: turns.map(t => ({
            question: t.question,
            answer: t.answer,
            score: t.score,
          })),
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("voice-interview-turn error:", errText);
        throw new Error("Erro na avaliação");
      }

      const result = await response.json();

      setCurrentFeedback({
        score: result.score,
        feedback: result.feedback,
        decision: result.decision,
      });

      // If repeat, don't add to turns yet
      if (result.decision === "repeat" && repeatCount < maxRepeats) {
        setPhase("feedback");
      } else {
        // Add turn
        const newTurn: TurnResult = {
          question: currentQ.text,
          answer: result.transcription,
          score: result.score,
          feedback: result.feedback,
          decision: result.decision === "repeat" ? "continue" : result.decision,
        };
        setTurns(prev => [...prev, newTurn]);
        setTotalScore(prev => prev + result.score);
        setPhase("feedback");
      }
    } catch (err) {
      safeToast.error(err);
      // Fallback - let them continue
      setCurrentFeedback({
        score: 70,
        feedback: "Resposta registrada. Vamos continuar.",
        decision: "continue",
      });
      const newTurn: TurnResult = {
        question: currentQ.text,
        answer: "[processamento offline]",
        score: 70,
        feedback: "Processamento offline",
        decision: "continue",
      };
      setTurns(prev => [...prev, newTurn]);
      setTotalScore(prev => prev + 70);
      setPhase("feedback");
    } finally {
      setIsAnalyzing(false);
    }
  }, [currentQ, currentQIdx, questions.length, turns, repeatCount, stepId, content.job_title]);

  const handleNext = useCallback(() => {
    if (!currentFeedback) return;

    if (currentFeedback.decision === "repeat" && repeatCount < maxRepeats) {
      // Repeat this question
      setRepeatCount(prev => prev + 1);
      setAudioBlob(null);
      setCurrentFeedback(null);
      setPhase("ready");
      return;
    }

    if (currentFeedback.decision === "end" || currentQIdx >= questions.length - 1) {
      // End interview
      finishInterview();
      return;
    }

    // Continue to next question
    setCurrentQIdx(prev => prev + 1);
    setRepeatCount(0);
    setAudioBlob(null);
    setCurrentFeedback(null);
    setPhase("ready");
  }, [currentFeedback, currentQIdx, questions.length, repeatCount]);

  const finishInterview = useCallback(() => {
    setPhase("done");
    const avgScore = turns.length > 0 ? Math.round(totalScore / turns.length) : 0;
    const responsePayload = {
      type: "entrevista_voz_conversacional",
      turns: turns.map(t => ({
        question: t.question,
        answer: t.answer,
        score: t.score,
      })),
      total_score: avgScore,
      total_turns: turns.length,
      total_questions: questions.length,
    };
    onSubmit(responsePayload, avgScore);
  }, [turns, totalScore, questions.length, onSubmit]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const scoreColor = (score: number) => {
    if (score >= 70) return "text-green-600";
    if (score >= 40) return "text-amber-600";
    return "text-red-600";
  };

  // --- RENDER ---

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
          <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400">
              <Bot className="h-4 w-4" />
              Entrevista Conversacional com IA
            </div>
            <p className="text-sm text-muted-foreground">
              A IA fará {questions.length} pergunta(s). Após cada resposta, você receberá um feedback. 
              Se necessário, a IA pode pedir que você refaça uma resposta com uma dica.
            </p>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>📋 {questions.length} pergunta(s) nesta entrevista</p>
            <p>⏱️ Tempo máximo por resposta: {questions[0]?.max_seconds || 120}s</p>
            <p>🤖 Feedback em tempo real após cada resposta</p>
          </div>
          <Button onClick={() => { setConsented(true); setPhase("ready"); }} className="w-full">
            <Mic className="h-4 w-4 mr-2" />
            Concordo e quero iniciar
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "done") {
    const avgScore = turns.length > 0 ? Math.round(totalScore / turns.length) : 0;
    return (
      <Card>
        <CardContent className="py-8 space-y-4">
          <div className="text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <h3 className="text-lg font-semibold">Entrevista Concluída</h3>
            <p className="text-sm text-muted-foreground">
              Suas respostas foram avaliadas pela IA.
            </p>
            <div className={`text-2xl font-bold ${scoreColor(avgScore)}`}>
              {avgScore}/100
            </div>
          </div>
          {/* Resumo dos turnos */}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {turns.map((t, i) => (
              <div key={i} className="bg-muted/50 rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Pergunta {i + 1}</span>
                  <Badge variant={t.score >= 60 ? "default" : "secondary"} className="text-[10px]">
                    {t.score}/100
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">{t.question}</p>
              </div>
            ))}
          </div>
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
        {/* Chat-style question from AI */}
        {currentQ && (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="space-y-1 flex-1">
              {currentQ.block && (
                <Badge variant="secondary" className="text-[10px]">{currentQ.block}</Badge>
              )}
              <div className="bg-muted rounded-lg rounded-tl-none p-3">
                <p className="text-sm">{currentQ.text}</p>
              </div>
              {repeatCount > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2 border border-amber-200 dark:border-amber-800">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    💡 Tente ser mais específico(a) e claro(a) na sua resposta.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ready to record */}
        {phase === "ready" && (
          <div className="flex justify-center">
            <Button onClick={startRecording} size="lg" className="gap-2">
              <Mic className="h-5 w-5" />
              {repeatCount > 0 ? "Gravar novamente" : "Gravar resposta"}
            </Button>
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

        {/* Analyzing */}
        {phase === "analyzing" && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Analisando sua resposta...</p>
              <p className="text-xs text-muted-foreground">A IA está transcrevendo e avaliando</p>
            </div>
          </div>
        )}

        {/* Feedback from AI */}
        {phase === "feedback" && currentFeedback && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="bg-muted rounded-lg rounded-tl-none p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Feedback da IA</span>
                    <span className={`text-sm font-bold ${scoreColor(currentFeedback.score)}`}>
                      {currentFeedback.score}/100
                    </span>
                  </div>
                  <p className="text-sm">{currentFeedback.feedback}</p>
                  {currentFeedback.decision === "repeat" && repeatCount < maxRepeats && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2 border border-amber-200 dark:border-amber-800">
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        🔄 A IA sugere que você tente responder novamente.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <Button onClick={handleNext} className="w-full">
              {currentFeedback.decision === "repeat" && repeatCount < maxRepeats
                ? <>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Tentar novamente
                  </>
                : currentFeedback.decision === "end" || currentQIdx >= questions.length - 1
                ? <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Finalizar entrevista
                  </>
                : <>
                    <Mic className="h-4 w-4 mr-2" />
                    Próxima pergunta
                  </>
              }
            </Button>
          </div>
        )}

        {/* Previous turns summary */}
        {turns.length > 0 && (
          <div className="border-t pt-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Respostas anteriores</p>
            <div className="flex gap-1">
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-full ${
                    t.score >= 70 ? "bg-green-500" : t.score >= 40 ? "bg-amber-500" : "bg-red-500"
                  }`}
                  title={`P${i + 1}: ${t.score}/100`}
                />
              ))}
              {Array.from({ length: questions.length - turns.length }).map((_, i) => (
                <div key={`empty-${i}`} className="h-2 flex-1 rounded-full bg-muted" />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
