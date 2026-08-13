import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Bot, User, Send, Mic, CheckCircle2, Loader2, Volume2, VolumeX, ArrowLeft, Play, Pause, Rewind, FastForward, PenLine, Keyboard } from "lucide-react";
import { VoiceRecordingStep } from "@/components/triage/VoiceRecordingStep";
import { aiAudioEngine } from "@/lib/aiAudioEngine";
import { fetchTTS, prefetchTTS, resetTTSCache } from "@/lib/aiSpeechService";
import {
  InterviewState,
  InterviewQuestion,
  normalizeQuestionType,
  getAIReaction,
} from "./InterviewStateMachine";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

interface ChatMessage {
  role: "bot" | "user";
  content: string;
  questionIndex?: number;
  msgId?: string;
}

interface AIInterviewChatboxProps {
  questions: InterviewQuestion[];
  templateTitle: string;
  onComplete: (answers: Record<number, string>, scores?: Record<number, number>) => void;
  isSubmitting?: boolean;
}

let msgCounter = 0;
function nextMsgId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

export function AIInterviewChatbox({
  questions,
  templateTitle,
  onComplete,
  isSubmitting,
}: AIInterviewChatboxProps) {
  const [state, setState] = useState<InterviewState>("idle");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    try { const s = sessionStorage.getItem(`test_answers_${templateTitle}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [scores, setScores] = useState<Record<number, number>>(() => {
    try { const s = sessionStorage.getItem(`test_scores_${templateTitle}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [audioPaused, setAudioPaused] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [responseMode, setResponseMode] = useState<"text" | "voice" | null>(() => {
    try { const s = sessionStorage.getItem(`interview_mode_${templateTitle}`); return (s === "text" || s === "voice") ? s : null; } catch { return null; }
  });
  const [showModeSelector, setShowModeSelector] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { data: chatboxSettings } = useGlobalSettings("chatbox");
  const spokenSet = useRef(new Set<string>());
  const initialized = useRef(false);
  const responseModeRef = useRef(responseMode);

  // Keep ref in sync
  useEffect(() => {
    responseModeRef.current = responseMode;
  }, [responseMode]);

  // Persist answers/scores to sessionStorage
  useEffect(() => {
    sessionStorage.setItem(`test_answers_${templateTitle}`, JSON.stringify(answers));
  }, [answers, templateTitle]);
  useEffect(() => {
    sessionStorage.setItem(`test_scores_${templateTitle}`, JSON.stringify(scores));
  }, [scores, templateTitle]);

  // Persist response mode
  useEffect(() => {
    if (responseMode) {
      sessionStorage.setItem(`interview_mode_${templateTitle}`, responseMode);
    }
  }, [responseMode, templateTitle]);

  // Warm up engine on mount, cleanup on unmount
  useEffect(() => {
    resetTTSCache();
    if (responseMode === "voice") {
      aiAudioEngine.warmUp();
    }
    return () => {
      aiAudioEngine.stop();
    };
  }, [responseMode]);

  // Sync mute state
  useEffect(() => {
    aiAudioEngine.setMuted(!ttsEnabled);
  }, [ttsEnabled]);

  // Poll audio state for UI sync
  useEffect(() => {
    const interval = setInterval(() => {
      const speaking = aiAudioEngine.isSpeaking();
      const paused = aiAudioEngine.isPaused();
      setAudioActive(speaking || paused);
      setAudioPaused(paused);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const progress = questions.length > 0 ? Math.round((Math.max(0, currentIdx) / questions.length) * 100) : 0;

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, state]);

  // Helper: build speech text for a question index
  const questionSpeechText = useCallback((idx: number) => {
    const q = questions[idx];
    return `Pergunta ${idx + 1} de ${questions.length}: ${q.text}${q.context ? `. ${q.context}` : ""}`;
  }, [questions]);

  /**
   * Speak text via TTS. Sends full text as ONE request (no chunking).
   * Waits for audio to finish playing before resolving.
   */
  const speakMessage = useCallback(async (text: string, messageId: string) => {
    if (responseModeRef.current !== "voice") return;
    if (spokenSet.current.has(messageId)) return;
    spokenSet.current.add(messageId);

    const url = await fetchTTS(text);
    if (!url) return;

    aiAudioEngine.enqueue(url);
    await aiAudioEngine.waitUntilIdle();
  }, []);

  // Initialize: pre-populate greeting + first question, speak them, go to awaiting_answer
  useEffect(() => {
    if (initialized.current || questions.length === 0 || chatboxSettings === undefined || !responseMode) return;
    initialized.current = true;

    const introId = nextMsgId();
    const welcomeTemplate = chatboxSettings?.find(s => s.key === "welcome_message_interview")?.value;
    const defaultIntro = `Olá! Vou conduzir sua entrevista agora — ${templateTitle}. São ${questions.length} perguntas. Responda naturalmente. Vamos começar!`;
    let introText = defaultIntro;
    if (typeof welcomeTemplate === "string" && welcomeTemplate.trim()) {
      introText = welcomeTemplate.replace(/\{titulo\}/g, templateTitle).replace(/\{total_perguntas\}/g, String(questions.length));
    }
    const introContent = introText.replace(templateTitle, `**${templateTitle}**`);

    const q = questions[0];
    const q1Id = nextMsgId();
    const q1Content = `**Pergunta 1/${questions.length}:** ${q.text}${q.context ? `\n\n_${q.context}_` : ""}`;
    const q1Speech = questionSpeechText(0);

    setMessages([
      { role: "bot", content: introContent, msgId: introId },
      { role: "bot", content: q1Content, msgId: q1Id, questionIndex: 0 },
    ]);
    setCurrentIdx(0);
    setState("awaiting_answer");

    // Speak intro then first question sequentially
    (async () => {
      // Prefetch question audio while intro plays
      if (responseModeRef.current === "voice") prefetchTTS(q1Speech);
      await speakMessage(introText, introId);
      // Small delay then speak question
      setTimeout(async () => {
        await speakMessage(q1Speech, q1Id);
      }, 400);
    })();
  }, [questions, templateTitle, questionSpeechText, speakMessage, chatboxSettings, responseMode]);

  const advanceToNext = useCallback(
    (answerText: string, score?: number) => {
      setState("processing");
      const newAnswers = { ...answers, [currentIdx]: answerText };
      const newScores =
        score !== undefined ? { ...scores, [currentIdx]: score } : scores;
      setAnswers(newAnswers);
      if (score !== undefined) setScores(newScores);

      const userMsg: ChatMessage = { role: "user", content: answerText };
      const nextIdx = currentIdx + 1;

      // Prefetch next question audio immediately
      if (nextIdx < questions.length && responseModeRef.current === "voice") {
        prefetchTTS(questionSpeechText(nextIdx));
      }

      if (nextIdx >= questions.length) {
        // Finished
        const finishId = nextMsgId();
        const finishContent = "✅ **Entrevista finalizada!**\nEstou analisando suas respostas...";
        const finishSpeech = "Entrevista finalizada! Estou analisando suas respostas.";

        setMessages((prev) => [
          ...prev,
          userMsg,
          { role: "bot", content: finishContent, msgId: finishId },
        ]);
        speakMessage(finishSpeech, finishId);
        setCurrentIdx(nextIdx);
        setState("finished");

        // Ensure scores are always passed (default 50 for unscored essay questions)
        const finalScores = { ...newScores };
        for (let i = 0; i < questions.length; i++) {
          if (finalScores[i] === undefined) finalScores[i] = 50;
        }
        console.log("[AIInterviewChatbox] Completing. Answers:", Object.keys(newAnswers).length, "Scores:", finalScores);

        setTimeout(
          () => onComplete(newAnswers, finalScores),
          1500
        );
      } else {
        // AI reaction then next question — both appear instantly
        const reaction = getAIReaction();
        const reactionId = nextMsgId();
        const nq = questions[nextIdx];
        const nqId = nextMsgId();
        const nqContent = `**Pergunta ${nextIdx + 1}/${questions.length}:** ${nq.text}${nq.context ? `\n\n_${nq.context}_` : ""}`;
        const nqSpeech = questionSpeechText(nextIdx);

        setMessages((prev) => [
          ...prev,
          userMsg,
          { role: "bot", content: reaction, msgId: reactionId },
          { role: "bot", content: nqContent, msgId: nqId, questionIndex: nextIdx },
        ]);
        setCurrentIdx(nextIdx);

        // Speak reaction then question
        (async () => {
          await speakMessage(reaction, reactionId);
          setTimeout(async () => {
            await speakMessage(nqSpeech, nqId);
            setState("awaiting_answer");
          }, 300);
        })();

        // Set awaiting after a brief delay so UI updates
        setTimeout(() => setState("awaiting_answer"), 600);
      }
    },
    [currentIdx, questions, answers, scores, onComplete, questionSpeechText, speakMessage]
  );

  const goBack = useCallback(() => {
    if (currentIdx <= 0 || state === "finished") return;
    aiAudioEngine.stop();
    const prevIdx = currentIdx - 1;
    // Keep messages up to and including the previous question message
    setMessages((prev) => {
      let prevQMsgIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].questionIndex === prevIdx) { prevQMsgIdx = i; break; }
      }
      if (prevQMsgIdx === -1) return prev;
      return prev.slice(0, prevQMsgIdx + 1);
    });
    // Answers and scores are preserved — do NOT delete them
    setCurrentIdx(prevIdx);
    setTextInput(answers[prevIdx] || "");
    setState("awaiting_answer");
  }, [currentIdx, state, answers]);

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    advanceToNext(textInput.trim());
    setTextInput("");
  };

  const handleOptionSelect = (optionText: string, optionIdx: number) => {
    const q = questions[currentIdx];
    const isCorrect = q.options?.[optionIdx]?.correct;
    advanceToNext(optionText, isCorrect ? 100 : 0);
  };

  const currentQuestion =
    currentIdx >= 0 && currentIdx < questions.length
      ? questions[currentIdx]
      : null;
  const qType = currentQuestion
    ? normalizeQuestionType(currentQuestion.type)
    : null;
  const showInput = state === "awaiting_answer" && currentQuestion;

  // Simple markdown bold renderer
  const renderContent = (content: string) =>
    content.split(/\*\*(.*?)\*\*/g).map((part, pi) =>
      pi % 2 === 1 ? (
        <strong key={pi}>{part}</strong>
      ) : (
        <span key={pi}>{part}</span>
      )
    );

  // Mode selection handler
  const selectMode = useCallback((mode: "text" | "voice") => {
    setResponseMode(mode);
    setShowModeSelector(false);
    if (mode === "text") {
      aiAudioEngine.stop();
    }
  }, []);

  // Initial mode selection screen
  if (!responseMode) {
    return (
      <div className="flex flex-col h-full max-h-[75vh] items-center justify-center p-6 space-y-6">
        <div className="text-center space-y-2">
          <Bot className="h-12 w-12 text-primary mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">Como você prefere responder?</h2>
          <p className="text-sm text-muted-foreground">Você pode alterar a qualquer momento durante o teste.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <Button
            variant="outline"
            className="flex-1 h-auto py-4 flex flex-col items-center gap-2 rounded-xl border-2 hover:border-primary hover:bg-primary/5"
            onClick={() => selectMode("text")}
          >
            <PenLine className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium">Responder por Escrita</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-auto py-4 flex flex-col items-center gap-2 rounded-xl border-2 hover:border-primary hover:bg-primary/5"
            onClick={() => selectMode("voice")}
          >
            <Mic className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium">Responder por Áudio</span>
          </Button>
        </div>
      </div>
    );
  }

  // Mode selector overlay (when changing mode mid-test)
  if (showModeSelector) {
    return (
      <div className="flex flex-col h-full max-h-[75vh] items-center justify-center p-6 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Trocar modo de resposta</h2>
          <p className="text-sm text-muted-foreground">Suas respostas anteriores serão mantidas.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <Button
            variant={responseMode === "text" ? "default" : "outline"}
            className="flex-1 h-auto py-4 flex flex-col items-center gap-2 rounded-xl border-2"
            onClick={() => selectMode("text")}
          >
            <PenLine className="h-6 w-6" />
            <span className="text-sm font-medium">Escrita</span>
          </Button>
          <Button
            variant={responseMode === "voice" ? "default" : "outline"}
            className="flex-1 h-auto py-4 flex flex-col items-center gap-2 rounded-xl border-2"
            onClick={() => selectMode("voice")}
          >
            <Mic className="h-6 w-6" />
            <span className="text-sm font-medium">Áudio</span>
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowModeSelector(false)} className="text-muted-foreground">
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[75vh]">
      {/* Progress */}
      <div className="px-4 py-2 border-b space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium">
            Pergunta {Math.min(Math.max(1, currentIdx + 1), questions.length)}{" "}
            de {questions.length}
          </span>
          <div className="flex items-center gap-1">
            {ttsEnabled && audioActive ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => aiAudioEngine.seekRelative(-10)}
                  title="Retroceder 10s"
                >
                  <Rewind className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => {
                    if (audioPaused) {
                      aiAudioEngine.resume();
                    } else {
                      aiAudioEngine.pause();
                    }
                  }}
                  title={audioPaused ? "Continuar" : "Pausar"}
                >
                  {audioPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => aiAudioEngine.seekRelative(10)}
                  title="Avançar 10s"
                >
                  <FastForward className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setTtsEnabled((v) => !v)}
                title={ttsEnabled ? "Desativar voz da IA" : "Ativar voz da IA"}
              >
                {ttsEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setShowModeSelector(true)}
              title={responseMode === "text" ? "Modo: Escrita" : "Modo: Áudio"}
            >
              {responseMode === "text" ? <PenLine className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </Button>
            <span>{progress}%</span>
          </div>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={msg.msgId || i}
            className={`flex gap-2 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "bot" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "bot"
                  ? "bg-muted text-foreground"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {renderContent(msg.content)}
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                <User className="h-4 w-4 text-secondary-foreground" />
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {state === "processing" && (
          <div className="flex gap-2 items-center">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-muted rounded-xl px-3.5 py-2.5">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        {isSubmitting && (
          <div className="flex gap-2 items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Enviando...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {showInput && (
        <div className="border-t px-4 py-3 space-y-2">
          {currentIdx > 0 && (
            <Button variant="ghost" size="sm" onClick={goBack} className="text-muted-foreground">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
          )}
          {qType === "quiz" && currentQuestion?.options && (
            <div className="flex flex-col gap-2">
              {answers[currentIdx] && (
                <p className="text-xs text-muted-foreground">Resposta anterior: <strong>{answers[currentIdx]}</strong> — selecione para alterar</p>
              )}
              {currentQuestion.options.map((opt, oi) => (
                <Button
                  key={oi}
                  variant={answers[currentIdx] === opt.text ? "default" : "outline"}
                  size="sm"
                  className="rounded-xl w-full text-left whitespace-normal h-auto py-2 justify-start"
                  onClick={() => handleOptionSelect(opt.text, oi)}
                >
                  {opt.text}
                </Button>
              ))}
            </div>
          )}

          {qType === "dissertativa" && responseMode === "text" && (
            <div className="flex gap-2">
              <Textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Digite sua resposta..."
                rows={2}
                className="flex-1 min-h-[60px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleTextSubmit();
                  }
                }}
              />
              <Button
                size="icon"
                onClick={handleTextSubmit}
                disabled={!textInput.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}

          {qType === "dissertativa" && responseMode === "voice" && (
            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Mic className="h-3.5 w-3.5" /> Grave sua resposta em áudio
              </p>
              <VoiceRecordingStep
                title=""
                content={{
                  questions: [
                    {
                      id: `interview_q${currentIdx}`,
                      text: currentQuestion?.text || "",
                      max_seconds: 120,
                      block: currentQuestion?.rubric || "",
                      weight: currentQuestion?.weight || 1,
                    },
                  ],
                  allow_repeat: true,
                }}
                stepId={`interview_q${currentIdx}`}
                applicationId="interview"
                onSubmit={(resp, score) => {
                  advanceToNext(
                    "🎤 Resposta em áudio enviada",
                    score ?? undefined
                  );
                }}
                isSubmitting={false}
              />
            </div>
          )}

          {qType === "voice" && (
            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Mic className="h-3.5 w-3.5" /> Grave sua resposta em áudio
              </p>
              <VoiceRecordingStep
                title=""
                content={{
                  questions: [
                    {
                      id: `interview_q${currentIdx}`,
                      text: currentQuestion?.text || "",
                      max_seconds: 120,
                      block: currentQuestion?.rubric || "",
                      weight: currentQuestion?.weight || 1,
                    },
                  ],
                  allow_repeat: true,
                }}
                stepId={`interview_q${currentIdx}`}
                applicationId="interview"
                onSubmit={(resp, score) => {
                  advanceToNext(
                    "🎤 Resposta em áudio enviada",
                    score ?? undefined
                  );
                }}
                isSubmitting={false}
              />
            </div>
          )}
        </div>
      )}

      {/* Finished state */}
      {state === "finished" && !isSubmitting && (
        <div className="border-t px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" />
            Respostas enviadas com sucesso
          </div>
        </div>
      )}
    </div>
  );
}
