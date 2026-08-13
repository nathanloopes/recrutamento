import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Bot, User, Send, Mic, Keyboard, CheckCircle2, Loader2, ArrowLeft, PenLine } from "lucide-react";
import { VoiceRecordingStep } from "@/components/triage/VoiceRecordingStep";
import { MediaAnswerInput } from "@/components/candidate/MediaAnswerInput";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

interface ChatQuestion {
  type: string;
  text: string;
  options?: { text: string; correct?: boolean }[];
  rubric?: string;
  weight?: number;
  context?: string;
  scale_labels?: { min: string; max: string };
}

interface ChatMessage {
  role: "bot" | "user";
  content: string;
  questionIndex?: number;
}

interface ChatboxTestRunnerProps {
  questions: ChatQuestion[];
  templateTitle: string;
  onComplete: (answers: Record<number, string>, scores?: Record<number, number>) => void;
  isSubmitting?: boolean;
  applicationId?: string;
  candidateId?: string;
}

type ResponseMode = "text" | "voice" | null;

const FREE_TEXT_TYPES = ["essay", "scenario", "text", "texto"];
const MEDIA_TYPES = ["video", "audio", "imagem", "image"];

export function ChatboxTestRunner({ questions, templateTitle, onComplete, isSubmitting, applicationId, candidateId }: ChatboxTestRunnerProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    try { const s = sessionStorage.getItem(`test_answers_${templateTitle}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [scores, setScores] = useState<Record<number, number>>(() => {
    try { const s = sessionStorage.getItem(`test_scores_${templateTitle}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [showingInput, setShowingInput] = useState(false);
  const [responseMode, setResponseMode] = useState<ResponseMode>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { data: chatboxSettings } = useGlobalSettings("chatbox");

  const progress = questions.length > 0 ? Math.round((currentIdx / questions.length) * 100) : 0;
  const isFinished = currentIdx >= questions.length;

  // Persist answers/scores to sessionStorage
  useEffect(() => {
    sessionStorage.setItem(`test_answers_${templateTitle}`, JSON.stringify(answers));
  }, [answers, templateTitle]);
  useEffect(() => {
    sessionStorage.setItem(`test_scores_${templateTitle}`, JSON.stringify(scores));
  }, [scores, templateTitle]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showingInput]);

  // Show first question only after mode is selected
  useEffect(() => {
    if (questions.length > 0 && messages.length === 0 && responseMode) {
      const q = questions[0];
      const welcomeTemplate = chatboxSettings?.find(s => s.key === "welcome_message_test")?.value;
      const defaultWelcome = `Vamos começar o teste **${templateTitle}**. São ${questions.length} perguntas.`;
      let welcomeText = defaultWelcome;
      if (typeof welcomeTemplate === "string" && welcomeTemplate.trim()) {
        welcomeText = welcomeTemplate.replace(/\{titulo\}/g, templateTitle).replace(/\{total_perguntas\}/g, String(questions.length));
      }
      const intro: ChatMessage = { role: "bot", content: welcomeText };
      const questionMsg: ChatMessage = { role: "bot", content: formatQuestion(q, 0), questionIndex: 0 };
      setMessages([intro, questionMsg]);
      setShowingInput(true);
    }
  }, [questions, responseMode]);

  const formatQuestion = (q: ChatQuestion, idx: number) => {
    let text = `**Pergunta ${idx + 1}/${questions.length}:** ${q.text}`;
    if (q.context) text += `\n\n_${q.context}_`;
    return text;
  };

  const advanceToNext = useCallback((answerText: string, score?: number) => {
    const newAnswers = { ...answers, [currentIdx]: answerText };
    const newScores = score !== undefined ? { ...scores, [currentIdx]: score } : scores;
    setAnswers(newAnswers);
    if (score !== undefined) setScores(newScores);

    const userMsg: ChatMessage = { role: "user", content: answerText };
    const newMessages = [...messages, userMsg];

    const nextIdx = currentIdx + 1;
    if (nextIdx >= questions.length) {
      const doneMsg: ChatMessage = { role: "bot", content: "✅ Teste concluído! Enviando suas respostas..." };
      setMessages([...newMessages, doneMsg]);
      setCurrentIdx(nextIdx);
      setShowingInput(false);

      // Ensure scores are always passed (default 50 for unscored questions)
      const finalScores = { ...newScores };
      for (let i = 0; i < questions.length; i++) {
        if (finalScores[i] === undefined) finalScores[i] = 50;
      }
      console.log("[ChatboxTestRunner] Completing. Answers:", Object.keys(newAnswers).length, "Scores:", finalScores);

      setTimeout(() => onComplete(newAnswers, finalScores), 500);
    } else {
      const nextQ = questions[nextIdx];
      const qMsg: ChatMessage = { role: "bot", content: formatQuestion(nextQ, nextIdx), questionIndex: nextIdx };
      setMessages([...newMessages, qMsg]);
      setCurrentIdx(nextIdx);
      setTextInput("");
      setShowingInput(true);
    }
  }, [currentIdx, questions, answers, scores, messages, onComplete]);

  const goBack = useCallback(() => {
    if (currentIdx <= 0 || isFinished) return;
    const prevIdx = currentIdx - 1;
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
    setShowingInput(true);
  }, [currentIdx, isFinished, answers]);

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    advanceToNext(textInput.trim());
  };

  const handleOptionSelect = (optionText: string, optionIdx: number) => {
    const q = questions[currentIdx];
    const isCorrect = q.options?.[optionIdx]?.correct;
    const score = isCorrect ? 100 : 0;
    advanceToNext(optionText, score);
  };

  const currentQuestion = !isFinished ? questions[currentIdx] : null;
  const qType = currentQuestion?.type || "multiple_choice";
  const isFreeText = FREE_TEXT_TYPES.includes(qType);

  // Mode selection screen
  if (!responseMode) {
    return (
      <div className="flex flex-col items-center justify-center h-full max-h-[70vh] px-6 py-12 space-y-6">
        <Bot className="h-12 w-12 text-primary" />
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Como você prefere responder?</h2>
          <p className="text-sm text-muted-foreground">Você pode alterar a qualquer momento durante o teste.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
          <Button
            variant="outline"
            className="flex-1 h-24 flex-col gap-2 rounded-xl border-2 hover:border-primary hover:bg-primary/5"
            onClick={() => setResponseMode("text")}
          >
            <PenLine className="h-7 w-7 text-primary" />
            <span className="text-sm font-medium">Responder por Escrita</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-24 flex-col gap-2 rounded-xl border-2 hover:border-primary hover:bg-primary/5"
            onClick={() => setResponseMode("voice")}
          >
            <Mic className="h-7 w-7 text-primary" />
            <span className="text-sm font-medium">Responder por Áudio</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[70vh]">
      {/* Progress */}
      <div className="px-4 py-2 border-b space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Pergunta {Math.min(currentIdx + 1, questions.length)} de {questions.length}</span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "bot" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
              msg.role === "bot" ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
            }`}>
              {msg.content.split(/\*\*(.*?)\*\*/g).map((part, pi) =>
                pi % 2 === 1 ? <strong key={pi}>{part}</strong> : <span key={pi}>{part}</span>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                <User className="h-4 w-4 text-secondary-foreground" />
              </div>
            )}
          </div>
        ))}
        {isSubmitting && (
          <div className="flex gap-2 items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Enviando...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {showingInput && currentQuestion && !isFinished && (
        <div className="border-t px-4 py-3 space-y-2">
          {currentIdx > 0 && (
            <Button variant="ghost" size="sm" onClick={goBack} className="text-muted-foreground">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
          )}

          {/* Multiple choice / True-false: chips */}
          {(qType === "multiple_choice" || qType === "true_false") && currentQuestion.options && (
            <div className="flex flex-col gap-2">
              {answers[currentIdx] && (
                <p className="text-xs text-muted-foreground">Resposta anterior: <strong>{answers[currentIdx]}</strong> — selecione para alterar</p>
              )}
              {currentQuestion.options.map((opt, oi) => (
                <Button key={oi} variant={answers[currentIdx] === opt.text ? "default" : "outline"} size="sm" className="rounded-xl w-full text-left whitespace-normal h-auto py-2 justify-start" onClick={() => handleOptionSelect(opt.text, oi)}>
                  {opt.text}
                </Button>
              ))}
            </div>
          )}

          {/* Free-text types: respects responseMode */}
          {isFreeText && responseMode === "text" && (
            <div className="flex gap-2">
              <Textarea
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder="Digite sua resposta..."
                rows={2}
                className="flex-1 min-h-[60px]"
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTextSubmit(); }
                }}
              />
              <div className="flex flex-col gap-1">
                <Button size="icon" onClick={handleTextSubmit} disabled={!textInput.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setResponseMode("voice")} title="Alternar para áudio">
                  <Mic className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {isFreeText && responseMode === "voice" && (
            <div className="space-y-2">
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => setResponseMode("text")} className="text-muted-foreground">
                  <Keyboard className="h-4 w-4 mr-1" />
                  Digitar
                </Button>
              </div>
              <VoiceRecordingStep
                title=""
                content={{
                  questions: [{
                    id: `chatbox_q${currentIdx}`,
                    text: currentQuestion.text,
                    max_seconds: 120,
                    block: currentQuestion.rubric || "",
                    weight: currentQuestion.weight || 1,
                  }],
                  allow_repeat: true,
                }}
                stepId={`chatbox_q${currentIdx}`}
                applicationId="chatbox"
                onSubmit={(resp, score) => {
                  advanceToNext("🎤 Resposta em áudio enviada", score ?? undefined);
                }}
                isSubmitting={false}
              />
            </div>
          )}

          {/* Forced voice_question */}
          {qType === "voice_question" && (
            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">Grave sua resposta em áudio</p>
              <VoiceRecordingStep
                title=""
                content={{
                  questions: [{
                    id: `chatbox_q${currentIdx}`,
                    text: currentQuestion.text,
                    max_seconds: 120,
                    block: currentQuestion.rubric || "",
                    weight: currentQuestion.weight || 1,
                  }],
                  allow_repeat: true,
                }}
                stepId={`chatbox_q${currentIdx}`}
                applicationId="chatbox"
                onSubmit={(resp, score) => {
                  advanceToNext("🎤 Resposta em áudio enviada", score ?? undefined);
                }}
                isSubmitting={false}
              />
            </div>
          )}

          {/* Media types: video / audio / imagem */}
          {MEDIA_TYPES.includes(qType) && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {qType === "video" ? "Envie um vídeo" : qType === "audio" ? "Envie um áudio" : "Envie uma imagem"} como resposta
              </p>
              <MediaAnswerInput
                mode={(qType === "image" ? "imagem" : qType) as "video" | "audio" | "imagem"}
                onChange={(path) => {
                  if (path) {
                    const filename = path.split("/").pop() || "anexo";
                    advanceToNext(`📎 ${filename}`);
                  }
                }}
                assignmentId={applicationId || "chatbox"}
                candidateId={candidateId || "chatbox"}
                questionIndex={currentIdx}
              />
            </div>
          )}

          {/* Scale */}
          {qType === "scale" && (
            <div className="flex flex-wrap gap-2 justify-center">
              {[1, 2, 3, 4, 5].map(v => (
                <Button key={v} variant="outline" size="sm" className="rounded-full w-10 h-10" onClick={() => advanceToNext(v.toString())}>
                  {v}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Finished state */}
      {isFinished && !isSubmitting && (
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
