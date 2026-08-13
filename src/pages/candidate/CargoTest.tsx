import { useMemo, useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2, Clock, Loader2, Award, MessageSquare, ListChecks, Briefcase, Heart } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { useCargoTestPipeline, useCandidateTestStatus, useSubmitCargoTestResult } from "@/hooks/useCargoTest";
import { useJobs } from "@/hooks/useJobs";
import { useJobsWithTests, jobHasTest } from "@/hooks/useJobsWithTests";
import { TextStep } from "@/components/triage/TextStep";
import { QuizStep } from "@/components/triage/QuizStep";
import { TrueFalseMultiStep } from "@/components/triage/TrueFalseMultiStep";
import { MediaStep } from "@/components/triage/MediaStep";
import { VoiceInterviewStep } from "@/components/triage/VoiceInterviewStep";
import { VoiceInterviewStep as ConversationalVoiceInterview } from "@/components/triage/ConversationalVoiceInterview";
import { VoiceRecordingStep } from "@/components/triage/VoiceRecordingStep";
import { AIInterviewChatbox } from "@/components/candidate/interview/AIInterviewChatbox";
import { aiAudioEngine } from "@/lib/aiAudioEngine";
import { normalizeQuestionType } from "@/components/candidate/interview/InterviewStateMachine";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useChatboxEnabled } from "@/hooks/useChatboxEnabled";


async function evaluateResponse(text: string, stepTitle: string, _jobTitle: string) {
  try {
    console.log("[CargoTest] AI evaluation started for:", stepTitle);
    const { data, error } = await supabase.functions.invoke("grade-essay", {
      body: {
        questions: [{
          question: stepTitle,
          candidate_answer: text,
          rubric: "",
          max_score: 100,
        }],
      },
    });
    if (error) {
      console.error("[CargoTest] grade-essay error:", error);
      return null;
    }
    const score = data?.results?.[0]?.score ?? null;
    console.log("[CargoTest] AI evaluation result:", score);
    return score;
  } catch (err) {
    console.error("[CargoTest] AI evaluation failed:", err);
    return null;
  }
}

async function batchEvaluateEssays(
  questions: { stepId: string; question: string; answer: string }[]
): Promise<Record<string, number>> {
  if (questions.length === 0) return {};
  try {
    console.log("[CargoTest] Batch AI evaluation for", questions.length, "essays");
    const { data, error } = await supabase.functions.invoke("grade-essay", {
      body: {
        questions: questions.map((q) => ({
          question: q.question,
          candidate_answer: q.answer,
          rubric: "",
          max_score: 100,
        })),
      },
    });
    if (error || !data?.results) {
      console.error("[CargoTest] Batch grade-essay error:", error);
      return {};
    }
    const scores: Record<string, number> = {};
    data.results.forEach((r: any, i: number) => {
      if (questions[i] && typeof r.score === "number") {
        scores[questions[i].stepId] = r.score;
      }
    });
    console.log("[CargoTest] Batch AI scores:", scores);
    return scores;
  } catch (err) {
    console.error("[CargoTest] Batch AI evaluation failed:", err);
    return {};
  }
}

export default function CargoTest() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();



  const { data: rawPipeline, isLoading: pipelineLoading } = useCargoTestPipeline(jobId);
  const { data: testStatus, isLoading: statusLoading } = useCandidateTestStatus(jobId);
  const { data: testsData, isLoading: testsLoading } = useJobsWithTests();
  const submitResult = useSubmitCargoTestResult();
  const { data: jobs } = useJobs(true);
  const job = jobs?.find((j) => j.id === jobId);

  // Defesa em profundidade: cargo sem teste vinculado não deve ser acessível
  // (regra de governança: vagas só ficam visíveis com teste atribuído)
  const cargoHasTest = jobHasTest(jobId, testsData);
  useEffect(() => {
    if (!testsLoading && testsData && !cargoHasTest) {
      toast.info("Este cargo ainda não está disponível para candidatura. Veja as oportunidades abertas.");
      navigate("/oportunidades", { replace: true });
    }
  }, [testsLoading, testsData, cargoHasTest, navigate]);

  // Esta tela (/teste-cargo/:jobId) é EXCLUSIVAMENTE a triagem pré-aplicação.
  // Ela SEMPRE roda apenas fases de triagem — fases posteriores (avaliação,
  // entrevista, pós-entrevista, etc.) pertencem ao fluxo da aplicação
  // (Triage.tsx / TestExecution.tsx) e nunca devem aparecer aqui, mesmo depois
  // que o candidato já tem uma aplicação ativa (hasChosenUnit).
  // Fases sem phase_kind são tratadas como triagem (compat. com pipelines legados).
  const pipeline = useMemo(() => {
    if (!rawPipeline) return rawPipeline;
    const filteredPhases = (rawPipeline as any).pipeline_phases.filter(
      (ph: any) => !ph.phase_kind || ph.phase_kind === "triagem"
    );
    return { ...(rawPipeline as any), pipeline_phases: filteredPhases };
  }, [rawPipeline]);

  const [currentPhaseIdx, setCurrentPhaseIdx] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  // Respostas indexadas por stepId → { questionId → { response, score, weight } }
  const [responses, setResponses] = useState<Record<string, Record<string, { response: any; score: number; weight: number }>>>({});
  const [evaluating, setEvaluating] = useState(false);
  const [finished, setFinished] = useState(false);
  const [finalResult, setFinalResult] = useState<{ score: number; approved: boolean } | null>(null);
  // Modo de execução fixado em "form": triagem sempre cai direto no formulário,
  // sem exibir tela de escolha entre Conversar/Formulário ao candidato.
  const [chosenMode, setChosenMode] = useState<"chatbox" | "form" | null>("form");
  const [introAccepted, setIntroAccepted] = useState(false);
  const [triageIntroAccepted, setTriageIntroAccepted] = useState(false);
  const [questionsStarted, setQuestionsStarted] = useState(false);
  const { enabled: chatboxFlagEnabled } = useChatboxEnabled();

  // If admin disabled the chatbox globally, force form mode and skip the picker.
  useEffect(() => {
    if (!chatboxFlagEnabled && chosenMode !== "form") {
      setChosenMode("form");
    }
  }, [chatboxFlagEnabled, chosenMode]);

  // Helper: extrai array normalizado de questions de um step (compat. legado)
  const getStepQuestions = useCallback((step: any): any[] => {
    const raw = step?.content?.questions;
    if (Array.isArray(raw) && raw.length > 0 && raw[0]?.type) return raw;
    // Legacy entrevista_voz com questions:[string]
    if (step?.type === "entrevista_voz" && Array.isArray(step?.content?.questions)) {
      return step.content.questions.map((q: any, i: number) => ({
        id: `q${i + 1}`,
        type: "voice",
        prompt: typeof q === "string" ? q : (q?.text || ""),
        max_seconds: 120,
        weight: 2,
      }));
    }
    // Wrap legado em questão única
    return [{
      id: "q1",
      type: step?.type || "texto",
      prompt: step?.content?.prompt || step?.content?.question || step?.title || "",
      weight: 2,
      ...(step?.content || {}),
    }];
  }, []);

  const allSteps = useMemo(() => {
    if (!pipeline) return [];
    return (pipeline as any).pipeline_phases.flatMap((ph: any) =>
      ph.pipeline_steps.map((s: any) => ({ ...s, phaseName: ph.name, phaseMinScore: ph.min_score }))
    );
  }, [pipeline]);

  // Total de PERGUNTAS (somatório das questions de todos os steps)
  const totalQuestions = useMemo(() => {
    return allSteps.reduce((sum: number, s: any) => sum + getStepQuestions(s).length, 0);
  }, [allSteps, getStepQuestions]);

  const totalSteps = allSteps.length;
  const flatIdx = useMemo(() => {
    let idx = 0;
    if (!pipeline) return 0;
    for (let p = 0; p < currentPhaseIdx && p < pipeline.pipeline_phases.length; p++) {
      idx += pipeline.pipeline_phases[p].pipeline_steps.length;
    }
    return idx + currentStepIdx;
  }, [pipeline, currentPhaseIdx, currentStepIdx]);

  const currentStep = allSteps[flatIdx] || null;
  const currentStepQuestions = useMemo(
    () => (currentStep ? getStepQuestions(currentStep) : []),
    [currentStep, getStepQuestions]
  );
  const currentQuestion = currentStepQuestions[currentQuestionIdx] || null;

  // Total de perguntas já respondidas (somatório de todos os steps)
  const answeredCount = useMemo(() => {
    return Object.values(responses).reduce((sum, qs) => sum + Object.keys(qs).length, 0);
  }, [responses]);

  const progress = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  // Check if the candidate chose chatbox mode
  const isChatboxMode = chosenMode === "chatbox";

  // Collect all questions from the current phase for chatbox mode
  // Expande cada step em suas N perguntas internas para o chatbox
  const chatboxQuestions = useMemo(() => {
    if (!isChatboxMode || !pipeline) return [];
    const currentPhase = pipeline.pipeline_phases[currentPhaseIdx];
    if (!currentPhase) return [];
    const out: any[] = [];
    for (const s of currentPhase.pipeline_steps as any[]) {
      const qs = getStepQuestions(s);
      for (const q of qs) {
        out.push({
          stepId: s.id,
          questionId: q.id,
          type: q.type === "quiz" ? "multiple_choice" : q.type === "texto" ? "essay" : q.type === "voice" ? "voice_question" : q.type,
          text: q.prompt || q.question || s.title || "",
          options: q.options || [],
          rubric: q.rubric || "",
          weight: q.weight || (q.type === "quiz" ? 1 : 2),
        });
      }
    }
    return out;
  }, [isChatboxMode, pipeline, currentPhaseIdx, getStepQuestions]);

  // Calcula score do step a partir das respostas individuais (média ponderada)
  const computeStepScore = useCallback((stepResponses: Record<string, { response: any; score: number; weight: number }>): number => {
    const entries = Object.values(stepResponses);
    if (entries.length === 0) return 0;
    const totalW = entries.reduce((s, e) => s + (e.weight || 1), 0);
    if (totalW === 0) return 0;
    const weighted = entries.reduce((s, e) => s + (e.score * (e.weight || 1)), 0);
    return weighted / totalW;
  }, []);

  // Submete UMA pergunta. Avança para próxima pergunta do step ou próximo step ou finaliza.
  const handleSubmit = useCallback(async (response: any, directScore?: number) => {
    if (!currentStep || !currentQuestion || !job) return;

    setEvaluating(true);
    let score = directScore ?? 0;

    // Texto/voz/mídia sem score → IA avalia
    if (directScore == null && response?.text) {
      const aiScore = await evaluateResponse(response.text, currentQuestion.prompt || currentStep.title, job.title);
      score = aiScore ?? 50;
    }

    const weight = Number(currentQuestion.weight) || (currentQuestion.type === "quiz" ? 1 : 2);

    const stepResponses = {
      ...(responses[currentStep.id] || {}),
      [currentQuestion.id]: { response, score, weight },
    };
    const newResponses = { ...responses, [currentStep.id]: stepResponses };
    setResponses(newResponses);
    setEvaluating(false);

    // Próxima pergunta dentro do mesmo step?
    const nextQuestionIdx = currentQuestionIdx + 1;
    if (nextQuestionIdx < currentStepQuestions.length) {
      setCurrentQuestionIdx(nextQuestionIdx);
      return;
    }

    // Step terminou — avançar para próximo step
    setCurrentQuestionIdx(0);
    const nextFlatIdx = flatIdx + 1;

    if (nextFlatIdx < totalSteps) {
      let remaining = nextFlatIdx;
      let phaseIdx = 0;
      for (const phase of pipeline!.pipeline_phases) {
        if (remaining < phase.pipeline_steps.length) {
          setCurrentPhaseIdx(phaseIdx);
          setCurrentStepIdx(remaining);
          break;
        }
        remaining -= phase.pipeline_steps.length;
        phaseIdx++;
      }
      return;
    }

    // Acabou tudo — finalizar
    if (submitResult.isPending) return;

    // Score final = média dos scores de step (cada step já é média ponderada interna)
    const stepScores = (Object.values(newResponses) as Record<string, { response: any; score: number; weight: number }>[])
      .map((stepRes) => computeStepScore(stepRes));
    const avgScore = stepScores.length > 0 ? stepScores.reduce((a, b) => a + b, 0) / stepScores.length : 0;

    const { data: roundingSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "scoring")
      .eq("key", "score_rounding")
      .maybeSingle();
    const roundingMode = typeof roundingSetting?.value === "string" ? roundingSetting.value : "round";
    const roundedScore = roundingMode === "floor" ? Math.floor(avgScore) : Math.round(avgScore);

    console.log("[CargoTest] Form completed. Step scores:", stepScores, "Avg:", roundedScore);

    setFinalResult({ score: roundedScore, approved: false });
    setFinished(true);

    try {
      const result = await submitResult.mutateAsync({
        jobId: jobId!,
        score: roundedScore,
        details: {
          responses: (Object.entries(newResponses) as [string, Record<string, { response: any; score: number; weight: number }>][])
            .map(([stepId, stepRes]) => ({
              step_id: stepId,
              score: computeStepScore(stepRes),
              breakdown: Object.entries(stepRes).map(([qid, r]) => ({
                question_id: qid, score: r.score, weight: r.weight,
              })),
            })),
          completed_at: new Date().toISOString(),
        },
      });
      setFinalResult({ score: roundedScore, approved: result.isApproved });
    } catch (err) {
      console.error("[CargoTest] Submit failed:", err);
      safeToast.error(err);
      setFinalResult({ score: roundedScore, approved: false });
    }
  }, [currentStep, currentQuestion, currentQuestionIdx, currentStepQuestions, job, flatIdx, totalSteps, responses, pipeline, jobId, submitResult, computeStepScore]);

  // Loading
  if (pipelineLoading || statusLoading) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Já fez o teste e foi aprovado
  if (testStatus?.isApproved) {
    return (
      <div className="px-4 pt-6 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/oportunidades")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Card className="border-2 border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h2 className="text-lg font-bold">Você já está aprovado!</h2>
            <p className="text-sm text-muted-foreground">
              Score: {Math.round(testStatus.score!)} — Você pode ver as unidades disponíveis.
            </p>
            <Button onClick={() => navigate(`/unidades-disponiveis?cargo=${jobId}`)}>
              Ver Unidades Próximas
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Já fez o teste mas não passou — bloqueia reteste
  if (testStatus?.hasTested && !testStatus?.isApproved) {
    return (
      <div className="px-4 pt-6 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/oportunidades")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Card className="border-2 border-yellow-200 dark:border-yellow-800">
          <CardContent className="p-6 text-center space-y-3">
            <Clock className="h-12 w-12 text-yellow-500 mx-auto" />
            <h2 className="text-lg font-bold">Teste já realizado</h2>
            <p className="text-sm text-muted-foreground">
              Seu score foi <strong>{Math.round(testStatus.score!)}</strong>. Seu perfil ficou registrado no banco de talentos para futuras oportunidades.
            </p>
            <p className="text-sm text-muted-foreground">
              Você poderá tentar novamente após o período de carência.
            </p>
            <Button variant="outline" onClick={() => navigate("/oportunidades")}>
              Voltar às Oportunidades
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sem pipeline configurado — fallback amigável
  // (o useEffect acima já redireciona; isto é a UI de transição enquanto navega)
  if (!pipeline || allSteps.length === 0) {
    return (
      <div className="px-4 pt-6 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/oportunidades")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar às oportunidades
        </Button>
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <Loader2 className="h-8 w-8 text-muted-foreground mx-auto animate-spin" />
            <p className="text-sm text-muted-foreground">
              Este cargo ainda não está disponível. Redirecionando para as oportunidades abertas...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Resultado final
  if (finished && finalResult) {
    const isProcessing = submitResult.isPending;
    return (
      <div className="px-4 pt-6 space-y-6">
        {isProcessing ? (
          <Card className="border-2 border-muted">
            <CardContent className="p-6 text-center space-y-4">
              <Loader2 className="h-14 w-14 text-primary mx-auto animate-spin" />
              <h2 className="text-xl font-bold text-foreground">Processando resultado...</h2>
              <p className="text-sm text-muted-foreground">
                Seu score calculado é <strong>{finalResult.score}</strong>. Salvando no sistema...
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className={`border-2 ${finalResult.approved ? "border-emerald-200 dark:border-emerald-800" : "border-yellow-200 dark:border-yellow-800"}`}>
            <CardContent className="p-6 text-center space-y-4">
              {finalResult.approved ? (
                <>
                  <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
                  <h2 className="text-xl font-bold text-foreground">Parabéns, {profile?.full_name?.split(" ")[0]}!</h2>
                  <p className="text-sm text-muted-foreground">
                    Você foi aprovado com score <strong>{finalResult.score}</strong>.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Agora veja as unidades mais próximas de você.
                  </p>
                  <Button size="lg" onClick={() => navigate(`/unidades-disponiveis?cargo=${jobId}`)}>
                    Ver Unidades Disponíveis
                  </Button>
                </>
              ) : (
                <>
                  <Heart className="h-14 w-14 text-amber-500 mx-auto" />
                  <h2 className="text-xl font-bold text-foreground">Obrigada pela sua participação 💛</h2>
                  <p className="text-sm text-muted-foreground">
                    Ainda não encontramos o melhor encaixe para você nesta vaga, mas seu perfil ficou registrado e pode ser chamado para outras oportunidades a qualquer momento.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                    <Button onClick={() => navigate("/lista-oportunidade")}>
                      Quero continuar acompanhando
                    </Button>
                    <Button variant="outline" onClick={() => navigate("/oportunidades")}>
                      Ver outras oportunidades
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Tela 0 — Perfil Institucional da Vaga (filtro psicológico antes do teste)
  if (!introAccepted) {
    return (
      <div className="px-4 pt-6 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/oportunidades")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>

        <Card className="border-2 border-primary/20" data-tour="job-intro-card">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Briefcase className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Vaga</p>
                <h1 className="text-lg font-bold text-foreground leading-tight">
                  {job?.title || "Cargo"}
                </h1>
              </div>
            </div>

            {job?.description ? (
              <div className="prose prose-sm max-w-none text-sm text-foreground/90 whitespace-pre-line">
                {job.description}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Antes de começar, leia com atenção. Esta etapa serve para você se identificar com a oportunidade e decidir conscientemente se é o que procura.
              </p>
            )}

            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              💡 A etapa a seguir é rapidinha — não é uma prova. Não existem respostas certas ou erradas, queremos apenas te conhecer melhor.
            </div>
          </CardContent>
        </Card>

        <div className="sticky bottom-0 z-40 -mx-4 px-4 py-5 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              size="lg"
              className="h-12 flex-1 font-semibold"
              onClick={() => {
                setIntroAccepted(true);
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Sim, é exatamente isso que quero fazer
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 flex-1 text-muted-foreground"
              onClick={() => navigate("/oportunidades")}
            >
              Quero ver outras vagas antes de decidir
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Etapa 3 — Introdução da Triagem unificada com início do teste.
  // Enquanto o candidato ainda não respondeu a primeira pergunta, mostramos
  // a mensagem de boas-vindas e, logo abaixo, ou a escolha de modo
  // (quando chatbox está habilitado globalmente) ou já a primeira pergunta.
  // Reduz cliques: o candidato lê e já começa a responder.
  const noResponsesYet = Object.keys(responses).length === 0;
  // Picker de modo desativado por decisão de produto: triagem vai direto às perguntas.
  const showModePicker = false;
  if (introAccepted && noResponsesYet && (showModePicker || chosenMode)) {
    if (!triageIntroAccepted) {
      // Marca evento de aceite na primeira renderização da tela combinada.
      // Usa setTimeout para evitar warning de setState durante render.
      setTimeout(() => {
        setTriageIntroAccepted(true);
      }, 0);
    }

    return (
      <div className="px-4 pt-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/oportunidades")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>

        {!questionsStarted && (
          <>
            <Card className="border-2 border-primary/20">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Heart className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-base font-bold text-foreground leading-tight">
                      Bora se conhecer?
                    </h1>
                  </div>
                </div>

                <div className="space-y-2 text-sm text-foreground/90 leading-relaxed">
                  <p>Vou fazer algumas perguntinhas aqui — não tem certo ou errado, é só pra entender um pouco do seu jeito e ajustar tudo certinho. 💛</p>
                  <p>Vem comigo, não demora muito não.</p>
                </div>
              </CardContent>
            </Card>

            <Button
              size="lg"
              className="w-full"
              onClick={() => setQuestionsStarted(true)}
            >
              Vamos lá
            </Button>
          </>
        )}

        {questionsStarted && renderStep()}
      </div>
    );
  }


  function renderStep() {
    if (!currentStep) return null;

    // Chatbox mode: render entire phase as a conversation
    if (isChatboxMode && chatboxQuestions.length > 0) {
      return (
        <Card className="overflow-hidden">
          <AIInterviewChatbox
            questions={chatboxQuestions.map((q: any, i: number) => ({
              id: `phase_${currentPhaseIdx}_${q.stepId}_${q.questionId}`,
              type: q.type || "multiple_choice",
              text: q.text,
              options: q.options,
              rubric: q.rubric,
              weight: q.weight,
            }))}
            templateTitle={job?.title || "Teste"}
            onComplete={async (chatAnswers, chatScores) => {
              if (submitResult.isPending) return;

              const newResponses = { ...responses };
              // Map answers back into (stepId, questionId)
              for (let i = 0; i < chatboxQuestions.length; i++) {
                const meta = chatboxQuestions[i];
                const answer = chatAnswers[i] || "";
                const score = chatScores?.[i] ?? 50;
                const weight = meta.weight || 2;
                if (!newResponses[meta.stepId]) newResponses[meta.stepId] = {};
                newResponses[meta.stepId][meta.questionId] = {
                  response: { text: answer },
                  score,
                  weight,
                };
              }

              // Batch evaluate essay answers via AI
              const essayQuestions: { stepId: string; questionId: string; question: string; answer: string }[] = [];
              for (let i = 0; i < chatboxQuestions.length; i++) {
                const meta = chatboxQuestions[i];
                if (meta.type === "essay" && chatAnswers[i]) {
                  essayQuestions.push({
                    stepId: meta.stepId,
                    questionId: meta.questionId,
                    question: meta.text,
                    answer: chatAnswers[i],
                  });
                }
              }

              if (essayQuestions.length > 0) {
                const aiScores = await batchEvaluateEssays(
                  essayQuestions.map((e) => ({ stepId: `${e.stepId}::${e.questionId}`, question: e.question, answer: e.answer }))
                );
                for (const [composite, aiScore] of Object.entries(aiScores)) {
                  const [stepId, questionId] = composite.split("::");
                  if (newResponses[stepId]?.[questionId]) {
                    newResponses[stepId][questionId] = { ...newResponses[stepId][questionId], score: aiScore };
                  }
                }
              }

              setResponses(newResponses);

              const nextPhaseIdx = currentPhaseIdx + 1;
              if (nextPhaseIdx >= pipeline!.pipeline_phases.length) {
                const stepScores = Object.values(newResponses).map((stepRes) => computeStepScore(stepRes));
                const avgScore = stepScores.length > 0 ? stepScores.reduce((a, b) => a + b, 0) / stepScores.length : 0;
                const roundedScore = Math.round(avgScore);

                setFinalResult({ score: roundedScore, approved: false });
                setFinished(true);

                try {
                  const result = await submitResult.mutateAsync({
                    jobId: jobId!,
                    score: roundedScore,
                    details: {
                      responses: Object.entries(newResponses).map(([stepId, stepRes]) => ({
                        step_id: stepId,
                        score: computeStepScore(stepRes),
                        breakdown: Object.entries(stepRes).map(([qid, r]) => ({
                          question_id: qid, score: r.score, weight: r.weight,
                        })),
                      })),
                      completed_at: new Date().toISOString(),
                    },
                  });
                  setFinalResult({ score: roundedScore, approved: result.isApproved });
                } catch (err) {
                  console.error("[CargoTest] Submit failed:", err);
                  safeToast.error(err);
                  setFinalResult({ score: roundedScore, approved: false });
                }
              } else {
                setCurrentPhaseIdx(nextPhaseIdx);
                setCurrentStepIdx(0);
                setCurrentQuestionIdx(0);
              }
            }}
            isSubmitting={submitResult.isPending}
          />
        </Card>
      );
    }

    if (!currentQuestion) return null;

    const qType = currentQuestion.type;
    const stepResponses = responses[currentStep.id] || {};
    const initialResponse = stepResponses[currentQuestion.id]?.response;
    const stepKey = `${currentStep.id}::${currentQuestion.id}`;
    // Sem rótulo "Triagem · Pergunta X de Y" — a barra de progresso global já mostra o avanço.
    const displayTitle = "";

    if (qType === "texto") {
      return (
        <TextStep
          key={stepKey}
          title={displayTitle}
          content={{ prompt: currentQuestion.prompt }}
          onSubmit={(resp) => handleSubmit(resp)}
          isSubmitting={evaluating}
          initialResponse={initialResponse}
        />
      );
    }

    if (qType === "quiz") {
      return (
        <QuizStep
          key={stepKey}
          title={displayTitle}
          content={{
            question: currentQuestion.prompt,
            options: currentQuestion.options || [],
          }}
          onSubmit={(resp, score) => {
            // QuizStep retorna 0 ou 100 (correct/wrong). Mas usamos peso por alternativa:
            // recalculamos o score localmente a partir do peso da opção.
            const idx = resp?.selected_index;
            const opt = currentQuestion.options?.[idx];
            let realScore = score;
            if (opt) {
              const w = opt.weight === "alto" ? 100 : opt.weight === "medio" ? 66 : opt.weight === "baixo" ? 33 : (typeof opt.correct === "boolean" ? (opt.correct ? 100 : 0) : 50);
              realScore = w;
            }
            handleSubmit(resp, realScore);
          }}
          isSubmitting={evaluating}
          initialResponse={initialResponse}
        />
      );
    }

    if (qType === "true_false") {
      // Migração inline: se vier do formato antigo (options [V,F]) cria 1 afirmativa única.
      const statements: Array<{ id: string; text: string; correct: boolean }> =
        Array.isArray(currentQuestion.statements) && currentQuestion.statements.length > 0
          ? currentQuestion.statements
          : (Array.isArray(currentQuestion.options) && currentQuestion.options.length === 2
              ? [{ id: "s1", text: currentQuestion.prompt || "", correct: currentQuestion.options.find((o: any) => o?.text === "Verdadeiro")?.weight === "alto" }]
              : [{ id: "s1", text: currentQuestion.prompt || "", correct: false }]);
      return (
        <TrueFalseMultiStep
          key={stepKey}
          title={displayTitle}
          prompt={currentQuestion.prompt}
          statements={statements}
          onSubmit={(resp, score) => handleSubmit(resp, score)}
          isSubmitting={evaluating}
        />
      );
    }

    if (qType === "imagem" || qType === "video" || qType === "audio") {
      return (
        <MediaStep
          key={stepKey}
          title={displayTitle}
          content={{ prompt: currentQuestion.prompt, url: currentQuestion.url }}
          type={qType}
          onSubmit={(resp) => handleSubmit(resp)}
          isSubmitting={evaluating}
          applicationId={jobId || "cargo-test"}
          candidateId={profile?.id || "anonymous"}
          questionIndex={currentQuestionIdx}
        />
      );
    }

    if (qType === "voice") {
      return (
        <VoiceRecordingStep
          key={stepKey}
          title={displayTitle}
          content={{
            question: currentQuestion.prompt,
            questions: [{ id: currentQuestion.id, text: currentQuestion.prompt, max_seconds: currentQuestion.max_seconds || 120, weight: currentQuestion.weight || 2 }],
          }}
          stepId={`${currentStep.id}_${currentQuestion.id}`}
          applicationId={jobId || ""}
          onSubmit={(resp, score) => handleSubmit(resp, score)}
          isSubmitting={evaluating}
        />
      );
    }

    if (qType === "entrevista_voz") {
      // Compat: legado entrevista_voz como step inteiro
      return (
        <ConversationalVoiceInterview
          key={stepKey}
          title={displayTitle}
          content={{ ...currentStep.content, job_title: job?.title }}
          stepId={currentStep.id}
          applicationId={jobId || ""}
          onSubmit={(resp, score) => handleSubmit(resp, score)}
          isSubmitting={evaluating}
        />
      );
    }

    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Tipo de pergunta não reconhecido: {qType}</p>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="px-4 pt-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/oportunidades")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
      </Button>

      <div>
        <h1 className="text-lg font-bold text-foreground">
          Teste — {job?.title || "Cargo"}
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {currentStep?.phaseName}
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Pergunta {Math.min(answeredCount + 1, totalQuestions)} de {totalQuestions}</span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {!isChatboxMode && (flatIdx > 0 || currentQuestionIdx > 0) && !evaluating && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Voltar à pergunta anterior dentro do step ou ao último question do step anterior
            if (currentQuestionIdx > 0) {
              setCurrentQuestionIdx(currentQuestionIdx - 1);
              return;
            }
            const prevFlatIdx = flatIdx - 1;
            if (prevFlatIdx < 0) return;
            let remaining = prevFlatIdx;
            let phaseIdx = 0;
            for (const phase of pipeline!.pipeline_phases) {
              if (remaining < phase.pipeline_steps.length) {
                setCurrentPhaseIdx(phaseIdx);
                setCurrentStepIdx(remaining);
                const prevStep = phase.pipeline_steps[remaining];
                const prevQs = getStepQuestions(prevStep);
                setCurrentQuestionIdx(Math.max(0, prevQs.length - 1));
                break;
              }
              remaining -= phase.pipeline_steps.length;
              phaseIdx++;
            }
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar à pergunta anterior
        </Button>
      )}

      {evaluating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Avaliando sua resposta...</span>
        </div>
      )}

      {renderStep()}
    </div>
  );
}
