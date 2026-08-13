import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { useTestAssignmentById, useStartTest, useSubmitTestResponse } from "@/hooks/useTests";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { toast } from "@/hooks/use-toast";
import { Clock, Upload, CheckCircle2, ArrowLeft, Mic, MessageSquare, ListChecks, Loader2, Sparkles } from "lucide-react";
import { VoiceTestStep } from "@/components/candidate/VoiceTestStep";
import { NativeFileInput, type NativeFileInputHandle } from "@/components/ui/NativeFileInput";
import { useRef } from "react";
import { MediaAnswerInput } from "@/components/candidate/MediaAnswerInput";
import { AIInterviewChatbox } from "@/components/candidate/interview/AIInterviewChatbox";
import { normalizeQuestionType } from "@/components/candidate/interview/InterviewStateMachine";
import { aiAudioEngine } from "@/lib/aiAudioEngine";
import { useEvaluateVoiceTest } from "@/hooks/useTests";
import { useChatboxEnabled } from "@/hooks/useChatboxEnabled";
import { formatDateBR } from "@/lib/dateUtils";

export default function TestExecution() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { data: assignment, isLoading } = useTestAssignmentById(assignmentId);
  const startMutation = useStartTest();
  const submitMutation = useSubmitTestResponse();
  const template = assignment?.test_templates;

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const fileUploadRef = useRef<NativeFileInputHandle>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  // Decisão de produto: candidato vai direto ao formulário, sem escolha de modo.
  const [chosenMode] = useState<"chatbox" | "form">("form");
  const [currentIdx, setCurrentIdx] = useState(0);

  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const evaluateVoiceMutation = useEvaluateVoiceTest();
  const [voiceEvaluating, setVoiceEvaluating] = useState(false);
  const { enabled: chatboxFlagEnabled } = useChatboxEnabled();
  const [submitElapsed, setSubmitElapsed] = useState(0);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const isSubmittingOverlay = submitMutation.isPending || voiceEvaluating || submitSuccess;

  // Tick elapsed seconds while submitting (for dynamic message)
  useEffect(() => {
    if (!submitMutation.isPending && !voiceEvaluating) {
      setSubmitElapsed(0);
      return;
    }
    setSubmitElapsed(0);
    const interval = setInterval(() => setSubmitElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [submitMutation.isPending, voiceEvaluating]);

  // Modo fixo em "form"; flag de chatbox não influencia mais essa tela.
  // Timer
  useEffect(() => {
    if (!assignment || !template?.time_limit_minutes || assignment.status !== "em_andamento" || !assignment.started_at) return;
    const endTime = new Date(assignment.started_at).getTime() + template.time_limit_minutes * 60 * 1000;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [assignment, template]);

  // Auto-submit when timer reaches zero
  useEffect(() => {
    if (timeLeft === 0 && assignment?.status === "em_andamento" && !autoSubmitted) {
      setAutoSubmitted(true);
      handleSubmit();
    }
  }, [timeLeft, assignment?.status, autoSubmitted]);

  const handleStart = async () => {
    if (!assignmentId) return;
    if (chosenMode === "chatbox") await aiAudioEngine.unlock();
    await startMutation.mutateAsync(assignmentId);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !assignment) return;
    setUploading(true);
    const path = `tests/${assignment.candidate_id}/${assignmentId}/${file.name}`;
    const storage = await getStorageClient();
    const { error } = await storage.storage.from("documents").upload(path, file, { upsert: true });
    if (error) {
      toast({ title: "Erro no upload", description: error.message, variant: "destructive" });
    } else {
      setFileUrl(path);
      toast({ title: "Arquivo enviado" });
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (!assignmentId) return;
    const response = template?.type === "quiz" ? { answers } : { file_url: fileUrl };
    try {
      await submitMutation.mutateAsync({ id: assignmentId, response });
      setSubmitSuccess(true);
      toast({ title: "Teste enviado com sucesso!" });
      setTimeout(() => navigate("/candidaturas"), 1200);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!assignment || !template) {
    return <div className="px-4 pt-6 text-center text-muted-foreground">Teste não encontrado.</div>;
  }

  const isCompleted = ["enviado", "corrigido", "aprovado", "reprovado"].includes(assignment.status);
  const isVoice = template.type === "voice";
  const isChatbox = chosenMode === "chatbox";
  const questions: any[] = (template.type === "quiz" || isVoice) ? (template.content?.questions || []) : [];

  const handleVoiceComplete = async (audioUrls: Record<string, string>, voiceQuestions: { id: string; text: string; weight?: number }[]) => {
    if (!assignmentId) return;
    setVoiceEvaluating(true);
    try {
      // First mark as submitted
      await submitMutation.mutateAsync({
        id: assignmentId,
        response: { type: "voice", audio_urls: audioUrls },
      });
      // Then trigger AI evaluation
      const result = await evaluateVoiceMutation.mutateAsync({
        test_assignment_id: assignmentId,
        audio_urls: audioUrls,
        questions: voiceQuestions,
      });
      toast({ title: "Teste avaliado!", description: `Nota: ${result.score}/100` });
    } catch (e: any) {
      toast({ title: "Erro na avaliação", description: e.message, variant: "destructive" });
    } finally {
      setVoiceEvaluating(false);
    }
  };

  const renderQuestion = (q: any, qi: number) => {
    const qType = q.type || "multiple_choice";

    return (
      <Card key={qi}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{qi + 1}. {q.text}</span>
            {q.weight && q.weight > 1 && <Badge variant="outline" className="text-[10px]">Peso {q.weight}</Badge>}
          </div>

          {/* Scenario context */}
          {qType === "scenario" && q.context && (
            <div className="bg-muted p-3 rounded-md text-sm">{q.context}</div>
          )}

          {/* Multiple choice / True-False */}
          {(qType === "multiple_choice" || qType === "true_false") && (
            <RadioGroup value={answers[qi] || ""} onValueChange={v => setAnswers(prev => ({ ...prev, [qi]: v }))}>
              {(q.options || []).map((opt: any, oi: number) => (
                <div key={oi} className="flex items-center gap-2">
                  <RadioGroupItem value={oi.toString()} id={`q${qi}-o${oi}`} />
                  <Label htmlFor={`q${qi}-o${oi}`} className="cursor-pointer">{opt.text}</Label>
                </div>
              ))}
            </RadioGroup>
          )}

          {/* Essay */}
          {(qType === "essay" || (qType === "scenario")) && (
            <div className="space-y-1">
              <Textarea
                value={answers[qi] || ""}
                onChange={e => setAnswers(prev => ({ ...prev, [qi]: e.target.value }))}
                placeholder="Digite sua resposta..."
                rows={4}
              />
              <p className="text-xs text-muted-foreground text-right">{(answers[qi] || "").length} caracteres</p>
            </div>
          )}

          {/* Scale */}
          {qType === "scale" && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{q.scale_labels?.min || "1"}</span>
                <span>{q.scale_labels?.max || "5"}</span>
              </div>
              <Slider
                value={[parseInt(answers[qi] || "3")]}
                onValueChange={([v]) => setAnswers(prev => ({ ...prev, [qi]: v.toString() }))}
                min={1} max={5} step={1}
              />
              <p className="text-center text-sm font-medium">{answers[qi] || "3"}</p>
            </div>
          )}

          {/* Imagem como escolha múltipla (até 6 imagens, 1 correta) */}
          {(qType === "imagem" || qType === "image") && Array.isArray(q.options) && q.options.some((o: any) => o?.image_url || o?.url) ? (
            <RadioGroup
              value={answers[qi] || ""}
              onValueChange={(v) => setAnswers((prev) => ({ ...prev, [qi]: v }))}
              className="grid grid-cols-2 sm:grid-cols-3 gap-3"
            >
              {(q.options || []).map((opt: any, oi: number) => {
                const url = opt?.image_url || opt?.url;
                const selected = answers[qi] === String(oi);
                return (
                  <label
                    key={oi}
                    htmlFor={`q${qi}-img-${oi}`}
                    className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                      selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <RadioGroupItem value={String(oi)} id={`q${qi}-img-${oi}`} className="sr-only" />
                    <img src={url} alt={`Opção ${oi + 1}`} className="w-full aspect-square object-cover" loading="lazy" />
                    <div className="absolute top-1 left-1 bg-background/90 text-foreground text-xs font-semibold rounded px-1.5 py-0.5">
                      {String.fromCharCode(65 + oi)}
                    </div>
                    {selected && (
                      <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center text-[10px] font-bold">
                        ✓
                      </div>
                    )}
                  </label>
                );
              })}
            </RadioGroup>
          ) : (qType === "video" || qType === "audio" || qType === "imagem" || qType === "image") && (
            <MediaAnswerInput
              mode={qType === "image" ? "imagem" : (qType as "video" | "audio" | "imagem")}
              maxSeconds={q.max_duration_seconds || q.max_seconds || 120}
              value={answers[qi]}
              onChange={(path) => setAnswers(prev => ({ ...prev, [qi]: path }))}
              assignmentId={assignmentId!}
              candidateId={assignment!.candidate_id}
              questionIndex={qi}
            />
          )}
        </CardContent>
      </Card>
    );
  };

  const allAnswered = questions.every((q: any, qi: number) => {
    const qType = q.type || "multiple_choice";
    if (qType === "scale") return true; // has default
    return !!answers[qi];
  });

  return (
    <div className="px-4 pt-6 pb-24 space-y-4 max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => navigate("/candidaturas")}>
        <ArrowLeft className="h-4 w-4 mr-1" />Voltar
      </Button>

      <div className="space-y-2">
        <h1 className="text-xl font-display font-bold text-foreground">{template.title}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{template.category}</Badge>
          {isVoice && <Badge variant="secondary" className="gap-1"><Mic className="h-3 w-3" />Voz</Badge>}
          {template.time_limit_minutes && (
            <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{template.time_limit_minutes} min</Badge>
          )}
          {assignment.is_mandatory && <Badge variant="destructive">Obrigatório</Badge>}
        </div>
        {template.description && <p className="text-sm text-muted-foreground">{template.description}</p>}
        {assignment.deadline && (
          <p className="text-xs text-muted-foreground">Prazo: {formatDateBR(assignment.deadline)}</p>
        )}
      </div>

      {/* Status: Pending — start directly in form mode */}
      {assignment.status === "pendente" && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <p className="text-center text-sm text-muted-foreground">
              Pronto para começar? Clique abaixo para iniciar o teste.
            </p>
            <Button onClick={handleStart} size="lg" className="w-full">
              Iniciar Teste
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Status: In progress - Voice */}
      {assignment.status === "em_andamento" && isVoice && (
        <VoiceTestStep
          assignmentId={assignmentId!}
          candidateId={assignment.candidate_id}
          template={{
            title: template.title,
            description: template.description,
            content: template.content,
          }}
          onComplete={handleVoiceComplete}
          isSubmitting={voiceEvaluating}
        />
      )}

      {/* Status: In progress - Chatbox (AI Interview) mode */}
      {assignment.status === "em_andamento" && !isVoice && isChatbox && questions.length > 0 && (
        <Card className="overflow-hidden">
          <AIInterviewChatbox
            questions={questions.map((q: any, i: number) => ({
              id: q.id || `q_${i}`,
              type: q.type || "multiple_choice",
              text: q.text,
              options: q.options,
              rubric: q.rubric,
              weight: q.weight,
              context: q.context,
              scale_labels: q.scale_labels,
            }))}
            templateTitle={template.title}
            onComplete={async (chatAnswers) => {
              try {
                await submitMutation.mutateAsync({ id: assignmentId!, response: { answers: chatAnswers } });
                setSubmitSuccess(true);
                toast({ title: "Teste enviado com sucesso!" });
                setTimeout(() => navigate("/candidaturas"), 1200);
              } catch (e: any) {
                toast({ title: "Erro", description: e.message, variant: "destructive" });
              }
            }}
            isSubmitting={submitMutation.isPending}
          />
        </Card>
      )}

      {/* Status: In progress - Form mode (Quiz/File) */}
      {assignment.status === "em_andamento" && !isVoice && !isChatbox && (
        <>
          {timeLeft !== null && (
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 border-b">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground flex items-center gap-1">
                  <Clock className="h-4 w-4" />Tempo restante
                </span>
                <span className={`text-lg font-mono font-bold ${timeLeft < 60 ? "text-destructive" : "text-foreground"}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
              <Progress value={template.time_limit_minutes ? ((template.time_limit_minutes * 60 - timeLeft) / (template.time_limit_minutes * 60)) * 100 : 0} className="h-1.5 mt-1" />
            </div>
          )}

          {template.type === "quiz" ? (
            (() => {
              const total = questions.length;
              const safeIdx = Math.min(currentIdx, Math.max(0, total - 1));
              const isLast = safeIdx === total - 1;
              const currentQ = questions[safeIdx];
              const qType = currentQ?.type || "multiple_choice";
              const currentAnswered = qType === "scale" ? true : !!answers[safeIdx];
              const progress = total > 0 ? Math.round(((safeIdx + 1) / total) * 100) : 0;

              return (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Pergunta {safeIdx + 1} de {total}</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-1.5" />
                  </div>

                  {currentQ && renderQuestion(currentQ, safeIdx)}

                  <div className="flex gap-2">
                    {safeIdx > 0 && (
                      <Button
                        variant="outline"
                        onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                        disabled={submitMutation.isPending}
                      >
                        <ArrowLeft className="h-4 w-4 mr-1" />Voltar
                      </Button>
                    )}
                    {isLast ? (
                      <Button
                        onClick={handleSubmit}
                        className="flex-1"
                        size="lg"
                        disabled={!allAnswered || submitMutation.isPending}
                      >
                        {submitMutation.isPending ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando...</>
                        ) : (
                          <><CheckCircle2 className="h-4 w-4 mr-2" />Enviar Respostas</>
                        )}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => setCurrentIdx((i) => Math.min(total - 1, i + 1))}
                        className="flex-1"
                        size="lg"
                        disabled={!currentAnswered}
                      >
                        Próxima
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <Card>
              <CardContent className="p-6 space-y-4">
                <p className="text-sm text-muted-foreground">Faça o upload do arquivo com suas respostas.</p>
                <NativeFileInput
                  ref={fileUploadRef}
                  accept=".pdf,.doc,.docx,.jpg,.png"
                  disabled={uploading}
                  onChange={handleFileUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={uploading}
                  onClick={() => fileUploadRef.current?.open()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? "Enviando..." : fileUrl ? "Trocar arquivo" : "Selecionar arquivo"}
                </Button>
                {fileUrl && <p className="text-xs text-primary">✓ Arquivo carregado</p>}
                <Button onClick={handleSubmit} className="w-full" disabled={!fileUrl}>
                  <Upload className="h-4 w-4 mr-2" />Enviar
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Status: Completed */}
      {isCompleted && (
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-primary mx-auto" />
            <p className="font-medium text-foreground">Teste enviado</p>
            <Badge variant="outline">{assignment.status}</Badge>
            {assignment.score != null && <p className="text-sm text-muted-foreground">Nota: {assignment.score}</p>}
          </CardContent>
        </Card>
      )}

      {/* Submitting overlay — bloqueia interação enquanto envia + IA avalia */}
      {isSubmittingOverlay && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm px-6"
          role="dialog"
          aria-live="polite"
          aria-busy={!submitSuccess}
        >
          <div className="max-w-sm w-full text-center space-y-5 rounded-2xl border bg-card p-8 shadow-xl">
            {submitSuccess ? (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="h-10 w-10 text-primary" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-foreground">Respostas enviadas!</h3>
                  <p className="text-sm text-muted-foreground">Redirecionando...</p>
                </div>
              </>
            ) : (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center relative">
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  {submitElapsed >= 5 && (
                    <Sparkles className="h-4 w-4 text-primary absolute -top-1 -right-1 animate-pulse" />
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-foreground">Enviando suas respostas...</h3>
                  <p className="text-sm text-muted-foreground min-h-[40px]">
                    {submitElapsed < 5 && "Salvando respostas..."}
                    {submitElapsed >= 5 && submitElapsed < 15 && "Nossa IA está avaliando suas respostas..."}
                    {submitElapsed >= 15 && submitElapsed < 30 && "Quase lá! Isso pode levar alguns instantes..."}
                    {submitElapsed >= 30 && "Estamos processando — obrigado pela paciência."}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                  <Clock className="h-3 w-3" />
                  <span>Não feche esta tela ({submitElapsed}s)</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
