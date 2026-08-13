/**
 * AIInterviewScreen — Voice-first interview UI.
 *
 * This component ONLY renders the InterviewEngine state.
 * All logic lives in InterviewOrchestrator.
 *
 * Flow:
 *  1. Consent screen (unlock audio + mic)
 *  2. AI speaks question (waveform animation)
 *  3. Candidate responds (recording indicator)
 *  4. Processing (brief spinner)
 *  5. Repeat until CLOSING
 *  6. Result screen
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Mic,
  MicOff,
  Square,
  Loader2,
  Volume2,
  CheckCircle2,
  XCircle,
  Award,
  Keyboard,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { InterviewOrchestrator } from "@/core/interviewOrchestrator";
import type {
  InterviewState,
  InterviewConfig,
  InterviewResult,
  InterviewStage,
  FinalDecision,
} from "@/core/interviewEngine";
import { interviewAudioEngine } from "@/core/interviewAudioEngine";

// ─── Stage Labels ───────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<InterviewStage, string> = {
  INTRODUCTION: "Apresentação",
  WARMUP: "Aquecimento",
  TECHNICAL_QUESTIONS: "Perguntas Técnicas",
  BEHAVIORAL_QUESTIONS: "Perguntas Comportamentais",
  SCENARIO_TEST: "Cenário Prático",
  FINAL_EVALUATION: "Avaliação Final",
  CLOSING: "Encerramento",
};

const STAGE_PROGRESS: Record<InterviewStage, number> = {
  INTRODUCTION: 5,
  WARMUP: 20,
  TECHNICAL_QUESTIONS: 45,
  BEHAVIORAL_QUESTIONS: 65,
  SCENARIO_TEST: 80,
  FINAL_EVALUATION: 90,
  CLOSING: 100,
};

// ─── Props ──────────────────────────────────────────────────────────────────────

interface AIInterviewScreenProps {
  config: InterviewConfig;
  onComplete: (result: InterviewResult) => void;
  onAbort?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function AIInterviewScreen({ config, onComplete, onAbort }: AIInterviewScreenProps) {
  const [phase, setPhase] = useState<"consent" | "interview" | "result">("consent");
  const [state, setState] = useState<InterviewState | null>(null);
  const [micGranted, setMicGranted] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [consentChecked, setConsentChecked] = useState(false);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const [retryBlocked, setRetryBlocked] = useState(false);

  // Read max_response_time from CrossConfig (voice category)
  const { data: voiceSettings } = useGlobalSettings("voice");
  const maxRecordingTime = useMemo(() => {
    const setting = voiceSettings?.find((s) => s.key === "max_response_time");
    const val = setting?.value;
    return typeof val === "number" && val > 0 ? val : 120;
  }, [voiceSettings]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const orchestratorRef = useRef<InterviewOrchestrator | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  // ── Consent ─────────────────────────────────────────────────────────────

  const handleConsent = useCallback(async () => {
    const orchestrator = new InterviewOrchestrator(config);
    orchestratorRef.current = orchestrator;

    const { mic } = await orchestrator.initialize();
    setMicGranted(mic);

    orchestrator.subscribe((s) => {
      setState({ ...s });
      if (s.isComplete && s.result) {
        setPhase("result");
        onComplete(s.result);
      }
    });

    setPhase("interview");
    try {
      await orchestrator.start();
    } catch (e: any) {
      if (e?.message === "RETRY_LIMIT_EXCEEDED") {
        setRetryBlocked(true);
        setPhase("consent");
        return;
      }
    }
  }, [config, onComplete]);

  // ── Audio Level Monitor ─────────────────────────────────────────────────

  // ── Recording Timer ─────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== "interview" || state?.status !== "listening") {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setRecordingTimer(0);
      return;
    }

    setRecordingTimer(0);
    timerRef.current = setInterval(() => {
      setRecordingTimer((prev) => {
        const next = prev + 1;
        if (next >= maxRecordingTime) {
          // Auto-stop recording when max time reached
          orchestratorRef.current?.submitAnswer();
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [phase, state?.status]);

  // ── Audio Level ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== "interview" || state?.status !== "listening") {
      setAudioLevel(0);
      return;
    }

    let active = true;
    const monitorLevel = () => {
      try {
        // Reuse the existing stream from interviewAudioEngine instead of creating a duplicate
        const existingStream = interviewAudioEngine.getStream();
        if (!existingStream) return;

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(existingStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!active) { ctx.close(); return; }
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
          setAudioLevel(avg);
          animFrameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
    };

    monitorLevel();
    return () => {
      active = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [phase, state?.status]);

  // ── Cleanup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      orchestratorRef.current?.dispose();
    };
  }, []);

  // ── Submit Answer ───────────────────────────────────────────────────────

  const handleStopRecording = useCallback(async () => {
    await orchestratorRef.current?.submitAnswer();
  }, []);

  const handleTextSubmit = useCallback(async () => {
    if (!textInput.trim()) return;
    const text = textInput;
    setTextInput("");
    setShowTextFallback(false);
    await orchestratorRef.current?.submitTextAnswer(text);
  }, [textInput]);

  const handleAbort = useCallback(() => {
    orchestratorRef.current?.abort("Candidato encerrou a entrevista");
    onAbort?.();
  }, [onAbort]);

  // ── Consent Screen ─────────────────────────────────────────────────────

  if (phase === "consent") {
    if (retryBlocked) {
      return (
        <Card className="mx-auto max-w-md">
          <CardContent className="p-6 space-y-6 text-center">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold">Limite de tentativas atingido</h2>
              <p className="text-sm text-muted-foreground">
                Você já realizou o número máximo de entrevistas por voz para esta vaga.
                Seu perfil continua ativo em nosso banco de talentos.
              </p>
            </div>
            {onAbort && (
              <Button variant="outline" className="w-full" onClick={onAbort}>
                Voltar
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="p-6 space-y-6 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
            <Mic className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Entrevista com IA</h2>
            <p className="text-sm text-muted-foreground">
              Você fará uma entrevista por voz com nossa recrutadora virtual Ana.
              A entrevista dura aproximadamente 5 minutos.
            </p>
          </div>
          <div className="text-left space-y-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-4">
            <p>• Suas respostas serão gravadas e avaliadas por IA</p>
            <p>• Fale de forma clara e objetiva</p>
            <p>• Use fones de ouvido para melhor experiência</p>
            <p>• Certifique-se de estar em um ambiente silencioso</p>
            <p>• Seus dados são protegidos conforme a LGPD</p>
          </div>
          <label className="flex items-start gap-2 text-left cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span className="text-xs text-muted-foreground">
              Autorizo a gravação e análise por IA das minhas respostas, conforme a Política de Privacidade (LGPD).
            </span>
          </label>
          <Button size="lg" className="w-full" onClick={handleConsent} disabled={!consentChecked}>
            <Mic className="w-4 h-4 mr-2" />
            Iniciar Entrevista
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Result Screen ───────────────────────────────────────────────────────

  if (phase === "result" && state?.result) {
    return <ResultScreen result={state.result} />;
  }

  // ── Interview Screen ──────────────────────────────────────────────────

  if (!state) return null;

  const progress = STAGE_PROGRESS[state.currentStage] || 0;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-md mx-auto">
      {/* Header */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {STAGE_LABELS[state.currentStage]}
            {" "}
            <span className="text-[10px] opacity-60">
              ({state.currentStageIndex + 1}/{Object.keys(STAGE_LABELS).length})
            </span>
          </span>
          <button
            onClick={handleAbort}
            className="text-xs text-destructive hover:underline"
          >
            Encerrar
          </button>
        </div>
        <Progress value={progress} className="h-1.5" />
        <div className="flex justify-between">
          {Object.values(STAGE_LABELS).map((label, idx) => (
            <div
              key={label}
              className={`w-2 h-2 rounded-full ${idx <= state.currentStageIndex ? "bg-primary" : "bg-muted"}`}
              title={label}
            />
          ))}
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 space-y-8">
        {/* AI Avatar + Status */}
        <div className="flex flex-col items-center space-y-4">
          <InterviewAvatar status={state.status} audioLevel={audioLevel} />

          {/* AI Message */}
          {state.currentAIMessage && (
            <div className="max-w-sm text-center">
              <p className="text-sm text-foreground leading-relaxed">
                {state.currentAIMessage}
              </p>
            </div>
          )}

          {/* Status Indicator */}
          <StatusIndicator status={state.status} />
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="px-4 pb-6 space-y-3">
        {state.status === "listening" && (
          <div className="flex flex-col items-center space-y-3">
            {/* Recording indicator bar */}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Gravando sua resposta...</span>
            </div>

            {/* Timer countdown */}
            <div className="text-sm font-mono tabular-nums text-muted-foreground">
              <span className={recordingTimer >= maxRecordingTime - 10 ? "text-red-500 font-semibold" : ""}>
                {Math.floor(recordingTimer / 60)}:{String(recordingTimer % 60).padStart(2, "0")}
              </span>
              <span className="text-xs ml-1">/ {Math.floor(maxRecordingTime / 60)}:{String(maxRecordingTime % 60).padStart(2, "0")}</span>
            </div>

            {/* Audio Level Bar */}
            <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-75 rounded-full"
                style={{ width: `${Math.max(5, audioLevel * 100)}%` }}
              />
            </div>

            <div className="flex gap-3">
              <Button size="lg" onClick={handleStopRecording} className="rounded-full px-8">
                <Square className="w-4 h-4 mr-2" />
                Enviar Resposta
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="rounded-full"
                onClick={() => setShowTextFallback(!showTextFallback)}
                title="Digitar resposta"
              >
                <Keyboard className="w-4 h-4" />
              </Button>
            </div>

            {/* Text Fallback */}
            {showTextFallback && (
              <div className="w-full flex gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
                  placeholder="Digite sua resposta..."
                  className="flex-1 rounded-lg border px-3 py-2 text-sm bg-background"
                  autoFocus
                />
                <Button size="sm" onClick={handleTextSubmit} disabled={!textInput.trim()}>
                  Enviar
                </Button>
              </div>
            )}
          </div>
        )}

        {state.status === "processing" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Analisando sua resposta...</span>
          </div>
        )}

        {state.status === "speaking" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Volume2 className="w-4 h-4 animate-pulse" />
            <span>Ana está falando...</span>
          </div>
        )}

        {/* Turn Counter */}
        <div className="text-center text-xs text-muted-foreground">
          {state.totalQuestionsAsked > 0 && (
            <span>Perguntas respondidas: {state.totalQuestionsAsked}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────────

function InterviewAvatar({
  status,
  audioLevel,
}: {
  status: string;
  audioLevel: number;
}) {
  const isSpeaking = status === "speaking";
  const isListening = status === "listening";
  const isProcessing = status === "processing";

  const ringSize = isSpeaking
    ? 80 + Math.sin(Date.now() / 200) * 8
    : isListening
    ? 80 + audioLevel * 20
    : 80;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
      {/* Pulsing ring */}
      <div
        className={`absolute rounded-full transition-all duration-150 ${
          isSpeaking
            ? "bg-primary/20 animate-pulse"
            : isListening
            ? "bg-red-500/20"
            : isProcessing
            ? "bg-yellow-500/20 animate-pulse"
            : "bg-muted/30"
        }`}
        style={{ width: ringSize, height: ringSize }}
      />
      {/* Avatar circle */}
      <div
        className={`relative w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-lg ${
          isSpeaking
            ? "bg-primary"
            : isListening
            ? "bg-red-500"
            : isProcessing
            ? "bg-yellow-600"
            : "bg-muted-foreground"
        }`}
      >
        {isListening ? (
          <Mic className="w-7 h-7" />
        ) : isSpeaking ? (
          <Volume2 className="w-7 h-7" />
        ) : isProcessing ? (
          <Loader2 className="w-7 h-7 animate-spin" />
        ) : (
          "A"
        )}
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const labels: Record<string, string> = {
    speaking: "Ana está falando",
    listening: "Sua vez de responder",
    processing: "Processando...",
    idle: "Preparando...",
    finished: "Entrevista concluída",
  };

  return (
    <span className="text-xs font-medium text-muted-foreground">
      {labels[status] || ""}
    </span>
  );
}

function ResultScreen({ result }: { result: InterviewResult }) {
  const decisionConfig: Record<FinalDecision, { icon: any; color: string; title: string; desc: string }> = {
    APPROVED: {
      icon: CheckCircle2,
      color: "text-emerald-500",
      title: "Aprovado!",
      desc: "Parabéns! Você será encaminhado para a próxima etapa.",
    },
    TALENT_POOL: {
      icon: Award,
      color: "text-blue-500",
      title: "Banco de Talentos",
      desc: "Seu perfil foi salvo em nosso banco de talentos.",
    },
    REJECTED: {
      icon: Clock,
      color: "text-yellow-500",
      title: "Disponível para novas oportunidades",
      desc: "Seu perfil foi registrado e você poderá ser convidado para futuras vagas compatíveis.",
    },
    ESCALATED: {
      icon: AlertTriangle,
      color: "text-orange-500",
      title: "Em Análise",
      desc: "Seu perfil será analisado por um recrutador humano. Entraremos em contato em breve.",
    },
  };

  const cfg = decisionConfig[result.decision];
  const Icon = cfg.icon;

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-6 space-y-6 text-center">
        <Icon className={`w-16 h-16 mx-auto ${cfg.color}`} />
        <div className="space-y-2">
          <h2 className="text-xl font-bold">{cfg.title}</h2>
          <p className="text-sm text-muted-foreground">{cfg.desc}</p>
        </div>

        {result.strengths.length > 0 && (
          <div className="text-left space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Pontos Fortes</p>
            <ul className="text-xs text-foreground space-y-0.5">
              {result.strengths.slice(0, 3).map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
        )}

        {result.weaknesses.length > 0 && (
          <div className="text-left space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Pontos a Desenvolver</p>
            <ul className="text-xs text-foreground space-y-0.5">
              {result.weaknesses.slice(0, 3).map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
