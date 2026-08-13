import { useMemo, useCallback, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApplicationTriage, useSubmitStepResponse, useAdvancePhase } from "@/hooks/useApplications";
import { TriageProgressBar } from "@/components/triage/ProgressBar";
import { TextStep } from "@/components/triage/TextStep";
import { QuizStep } from "@/components/triage/QuizStep";
import { TrueFalseMultiStep } from "@/components/triage/TrueFalseMultiStep";
import { MediaStep } from "@/components/triage/MediaStep";
import { ImageChoiceStep } from "@/components/triage/ImageChoiceStep";
import { VoiceInterviewStep } from "@/components/triage/VoiceInterviewStep";
import { VoiceRecordingStep } from "@/components/triage/VoiceRecordingStep";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, Clock, AlertTriangle, Loader2, CalendarPlus, ChevronLeft } from "lucide-react";
import { classifyPhase } from "@/components/candidate/ApplicationStatusCard";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { supabase } from "@/integrations/supabase/client";
import { useApplicationStatus } from "@/hooks/useApplicationStatus";
import { sendPipelineNotification } from "@/lib/pipelineEvents";
import { InterviewScheduler } from "@/components/candidate/InterviewScheduler";
import { TestScheduleDialog } from "@/components/candidate/TestScheduleDialog";
import { useApprovalSettings } from "@/hooks/useScheduling";
import { useQuery } from "@tanstack/react-query";
import { fetchPostInterviewTestUnlocked } from "@/lib/releasePostInterviewTest";
import { useAIConsent } from "@/hooks/useAIConsent";
import { AIConsentGate } from "@/components/candidate/AIConsentGate";

// Extrai array normalizado de questions de um step. Compat. com:
// - novo formato: content.questions = [{id, type, prompt, weight, options?...}]
// - legado entrevista_voz: content.questions = [string]
// - legado single-pergunta: content.{prompt|question|options}
function getStepQuestions(step: any): any[] {
  const raw = step?.content?.questions;
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.type) return raw;
  if (step?.type === "entrevista_voz" && Array.isArray(raw)) {
    return raw.map((q: any, i: number) => ({
      id: `q${i + 1}`,
      type: "voice",
      prompt: typeof q === "string" ? q : (q?.text || ""),
      max_seconds: 120,
      weight: 2,
    }));
  }
  return [{
    id: "q1",
    type: step?.type || "texto",
    prompt: step?.content?.prompt || step?.content?.question || step?.title || "",
    weight: 2,
    ...(step?.content || {}),
  }];
}

function quizScoreFromOption(opt: any): number {
  if (opt?.weight === "alto") return 100;
  if (opt?.weight === "medio") return 66;
  if (opt?.weight === "baixo") return 33;
  if (typeof opt?.correct === "boolean") return opt.correct ? 100 : 0;
  return 50;
}

function consolidateStepScore(answers: Array<{ score: number; weight: number }>): number {
  if (answers.length === 0) return 0;
  const totalW = answers.reduce((s, a) => s + (a.weight || 1), 0);
  if (totalW === 0) return 0;
  const weighted = answers.reduce((s, a) => s + a.score * (a.weight || 1), 0);
  return Math.round(weighted / totalW);
}

// Aciona o motor server-side de score para auditoria + gate de min_score.
// Best-effort: falhas não interrompem o fluxo client-side existente.
async function callPipelineScoreEngine(
  applicationId: string,
  phaseId: string,
  stepSubmissions: Array<{ step_id: string; raw_score: number }>
) {
  try {
    await supabase.functions.invoke("pipeline-score-engine", {
      body: { application_id: applicationId, phase_id: phaseId, step_submissions: stepSubmissions },
    });
  } catch (e) {
    console.error("[Triage] pipeline-score-engine failed:", e);
  }
}

async function triggerAutoEvaluation(stepResponseId: string, applicationId: string, mediaType?: string, mediaUrl?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  try {
    const res = await supabase.functions.invoke("auto-evaluate-response", {
      body: { step_response_id: stepResponseId, application_id: applicationId, media_type: mediaType, media_url: mediaUrl },
    });
    if (res.error) console.error("Auto-evaluate error:", res.error);
    return res.data;
  } catch (e) {
    console.error("Auto-evaluate failed:", e);
  }
}

export default function Triage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { hasConsent, grantConsent } = useAIConsent(applicationId);
  const { data, isLoading, refetch } = useApplicationTriage(applicationId!);
  const submitResponse = useSubmitStepResponse();
  const advancePhase = useAdvancePhase();
  const [evaluating, setEvaluating] = useState(false);
  // Wizard intra-step (etapa = bloco com N perguntas)
  const [intraStepIdx, setIntraStepIdx] = useState(0);
  const [intraAnswers, setIntraAnswers] = useState<Record<string, { response: any; score: number; weight: number }>>({});
  // Trava a UI depois que o candidato envia a última resposta do bloco,
  // para não voltar a exibir a Pergunta 1 enquanto o servidor processa/refetch.
  const [finalizingBlock, setFinalizingBlock] = useState(false);

  // Fetch doc pending status for the approval screen
  const jobId = data?.pipeline?.job_id;
  const { data: appStatusData } = useApplicationStatus(applicationId!, jobId);
  const isApprovedPendingDocs = appStatusData?.appStatus === "aprovado" && (appStatusData?.docPendingCount ?? 0) > 0;

  // Self-schedule gate (mesma flag usada no Home)
  const { data: approvalSettings } = useApprovalSettings();
  const canSelfSchedule = approvalSettings?.selfScheduleEnabled ?? true;
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [presencialOpen, setPresencialOpen] = useState(false);

  // Verifica se já existe entrevista ativa para esta candidatura
  const { data: activeInterview } = useQuery({
    queryKey: ["triage-active-interview", applicationId],
    enabled: !!applicationId && data?.application?.status === "aprovado",
    queryFn: async () => {
      const { data: iv } = await supabase
        .from("interviews")
        .select("id, status")
        .eq("application_id", applicationId!)
        .in("status", ["confirmed", "pending_approval", "reschedule_requested"])
        .limit(1)
        .maybeSingle();
      return iv;
    },
  });

  const { currentPhase, currentPhaseIndex, currentStep, currentStepIndex, answeredStepIds, visibleSteps } = useMemo(() => {
    if (!data) return { currentPhase: null, currentPhaseIndex: 0, currentStep: null, currentStepIndex: 0, answeredStepIds: new Set<string>(), visibleSteps: [] };
    
    const phases = data.pipeline.pipeline_phases;
    const answered = new Set(data.responses.map((r: any) => r.step_id));
    const profile = data.candidateProfile || {};
    
    const phaseIdx = phases.findIndex((p: any) => p.id === data.application.current_phase);
    const phase = phases[phaseIdx >= 0 ? phaseIdx : 0];
    
    if (!phase) return { currentPhase: null, currentPhaseIndex: 0, currentStep: null, currentStepIndex: 0, answeredStepIds: answered, visibleSteps: [] };
    
    // Filter steps by conditions (conditional questions based on profile)
    const filteredSteps = phase.pipeline_steps.filter((s: any) => {
      if (!s.conditions || !s.conditions.field) return true;
      const fieldValue = profile[s.conditions.field];
      return fieldValue && fieldValue.toLowerCase() === s.conditions.value?.toLowerCase();
    });

    const stepIdx = filteredSteps.findIndex((s: any) => !answered.has(s.id));
    const step = stepIdx >= 0 ? filteredSteps[stepIdx] : null;

    return {
      currentPhase: phase,
      currentPhaseIndex: phaseIdx >= 0 ? phaseIdx : 0,
      currentStep: step,
      currentStepIndex: stepIdx >= 0 ? stepIdx : filteredSteps.length,
      answeredStepIds: answered,
      visibleSteps: filteredSteps,
    };
  }, [data]);

  // Assim que a etapa (currentStep) muda de fato — porque a resposta foi
  // gravada e o refetch trouxe o novo estado — destrava a UI e reseta o wizard.
  useEffect(() => {
    setIntraStepIdx(0);
    setIntraAnswers({});
    setFinalizingBlock(false);
  }, [currentStep?.id]);



  const getMinScoreForPhase = useCallback((phase: any, config: any) => {
    if (!phase || !config) return 60;
    if (phase.min_score && phase.min_score > 0) return phase.min_score;
    const stepTypes = (phase.pipeline_steps || []).map((s: any) => s.type);
    if (stepTypes.includes("entrevista_humana")) return config.min_score_human_interview;
    if (stepTypes.includes("entrevista_voz")) return config.min_score_ia_interview;
    return config.min_score_phase_1;
  }, []);

  const applyRounding = useCallback((score: number, mode: string) => {
    return mode === "ceil" ? Math.ceil(score) : Math.floor(score);
  }, []);

  const logProgress = useCallback(async (phase: string, score: number | null, decision: string, ruleApplied: string, metadata?: any) => {
    if (!applicationId || !data) return;
    try {
      await supabase.from("candidate_progress_logs").insert({
        candidate_id: data.application.candidate_id,
        application_id: applicationId,
        phase,
        score,
        decision,
        rule_applied: ruleApplied,
        metadata: metadata || {},
      });
    } catch (e) {
      console.error("Failed to log progress:", e);
    }
  }, [applicationId, data]);

  const notifyAdminsMaxAttempts = useCallback(async (reason: string, metadata: any) => {
    if (!data) return;
    try {
      const { data: admins } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "rh_franqueadora"]);
      if (admins) {
        for (const admin of admins) {
          await supabase.from("notifications").insert({
            event_type: "max_attempts_reached",
            recipient_id: admin.user_id,
            channel: "push",
            title: "Limite de tentativas atingido",
            body: reason,
            status: "pending",
            action_url: "/admin/candidatos",
            action_type: "info",
            payload: metadata,
          } as any);
        }
      }
    } catch (e) {
      console.error("[Triage] Failed to notify admins max_attempts_reached:", e);
    }
  }, [data]);

  const calculateAndAdvancePhase = useCallback(async (allResponses: any[], retryCount: number) => {
    if (!currentPhase || !data || !applicationId) return;

    // Use visible (filtered) steps for calculation, skip optional steps without responses
    const phaseSteps = visibleSteps.length > 0 ? visibleSteps : currentPhase.pipeline_steps;
    let totalWeight = 0;
    let weightedSum = 0;

    for (const step of phaseSteps) {
      const resp = allResponses.find((r: any) => r.step_id === step.id);
      // Skip optional steps that have no response
      if (step.is_optional && (!resp || (resp?.score === undefined || resp.score === null))) {
        continue;
      }
      if (resp?.score !== undefined && resp.score !== null) {
        weightedSum += Number(resp.score) * Number(step.weight);
        totalWeight += Number(step.weight);
      }
    }

    // If no steps have scores yet (all pending AI evaluation), don't calculate
    if (totalWeight === 0) {
      toast.info("Aguardando avaliação das respostas...");
      return;
    }

    const rawScore = weightedSum / totalWeight;
    const phaseScore = applyRounding(rawScore, data.config.score_rounding);
    const minScore = getMinScoreForPhase(currentPhase, data.config);

    // Auditoria server-side: dispara o pipeline-score-engine
    const stepSubmissions = phaseSteps
      .map((step: any) => {
        const resp = allResponses.find((r: any) => r.step_id === step.id);
        if (resp?.score === undefined || resp?.score === null) return null;
        return { step_id: step.id, raw_score: Math.max(0, Math.min(100, Number(resp.score))) };
      })
      .filter(Boolean) as Array<{ step_id: string; raw_score: number }>;
    if (stepSubmissions.length > 0) {
      callPipelineScoreEngine(applicationId, currentPhase.id, stepSubmissions);
    }

    // ============= FASE POS-ENTREVISTA: sempre análise humana =============
    // Esta fase nunca decide sozinha — sem standby automático, sem moveToStandby,
    // sem cascata de onPhaseFailed/onPhaseCompleted. UMA notificação clara.
    const phaseKind = (currentPhase as any)?.phase_kind;
    if (phaseKind === "avaliacao_pos_entrevista") {
      await advancePhase.mutateAsync({ applicationId, status: "em_avaliacao", totalScore: phaseScore });
      await logProgress(
        currentPhase.name,
        phaseScore,
        "em_avaliacao",
        "awaiting_human_review:post_interview_test",
        { phase_kind: phaseKind, phase_min: minScore }
      );
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("notifications").insert({
            event_type: "post_interview_test_submitted",
            recipient_id: user.id,
            channel: "push",
            title: "Respostas enviadas",
            body: "Recebemos suas respostas do teste pós-entrevista. A unidade vai analisar e te avisamos por aqui.",
            status: "pending",
          } as any);
        }
      } catch (e) {
        console.error("[Triage] post_interview_test_submitted notify failed:", e);
      }
      toast.success("Respostas enviadas. A unidade vai analisar.");
      await refetch();
      return;
    }



    if (phaseScore >= minScore) {
      const phases = data.pipeline.pipeline_phases;
      const nextPhaseIdx = currentPhaseIndex + 1;

      if (nextPhaseIdx >= phases.length) {
        let totalScore = phaseScore;
        const extScores = data.externalScores || [];
        if (extScores.length > 0) {
          const extAvg = extScores.reduce((sum: number, e: any) => sum + e.score, 0) / extScores.length;
          totalScore = Math.round(phaseScore * 0.7 + extAvg * 0.3);
        }
        // REGRA: teste/avaliação NUNCA aprova sozinho. Mesmo padrão do módulo Testes:
        // candidato vai para "em_avaliacao" e aguarda decisão humana do recrutador.
        // Apenas score abaixo do mínimo da fase manda para standby (regra mantida).
        if (totalScore >= minScore) {
          await advancePhase.mutateAsync({ applicationId, status: "em_avaliacao", totalScore });
          await logProgress(
            currentPhase.name,
            totalScore,
            "em_avaliacao",
            totalScore >= data.config.min_score_hiring
              ? `awaiting_human_review:score_above_hiring:${data.config.min_score_hiring}`
              : `awaiting_human_review:score_above_phase_min:${minScore}`,
            { required: data.config.min_score_hiring, phase_min: minScore }
          );
          // Fire onHighScore if score is exceptional (>= 90) — notifica recrutador para priorizar
          if (totalScore >= 90) {
            sendPipelineNotification("onHighScore", { candidateId: data.application.candidate_id, pipelineName: data.pipeline.name, score: totalScore });
          }
          sendPipelineNotification("onPhaseCompleted", { candidateId: data.application.candidate_id, pipelineName: data.pipeline.name, phaseName: currentPhase.name, score: totalScore });
          toast.success("Teste concluído! Aguarde a análise do recrutador.");
        } else {
          await advancePhase.mutateAsync({ applicationId, status: "standby", totalScore });
          await logProgress(currentPhase.name, totalScore, "standby", `score_below_phase_min:${minScore}`, { required: minScore });
          sendPipelineNotification("onPhaseFailed", { candidateId: data.application.candidate_id, pipelineName: data.pipeline.name, phaseName: currentPhase.name, score: totalScore });
          try { const { moveToStandby } = await import("@/lib/moveToStandby"); await moveToStandby(data.application.candidate_id, `Score insuficiente: ${totalScore}/${minScore}`, data.application.unit_jobs?.job_id); } catch (e) { console.error("[Triage] moveToStandby error:", e); }
          toast.info("Você foi direcionado para a lista de oportunidades.");
        }
      } else {
        await advancePhase.mutateAsync({ applicationId, nextPhaseId: phases[nextPhaseIdx].id });
        await logProgress(currentPhase.name, phaseScore, "aprovado", `min_score:${minScore}`);
        sendPipelineNotification("onPhaseCompleted", { candidateId: data.application.candidate_id, pipelineName: data.pipeline.name, phaseName: currentPhase.name, score: phaseScore });
        toast.success("Fase concluída! Avançando para a próxima.");
      }
    } else {
      // Check escalation threshold: if score is close to min, escalate to human instead of failing
      const escalationThreshold = data.config.escalation_threshold ?? 0;
      const scoreDiff = minScore - phaseScore;
      const shouldEscalate = escalationThreshold > 0 && scoreDiff <= escalationThreshold;

      if (shouldEscalate) {
        // Escalate to human review instead of auto-failing
        await advancePhase.mutateAsync({ applicationId, status: "em_andamento" });
        await logProgress(currentPhase.name, phaseScore, "escalar_humano", `score_within_escalation_threshold:${escalationThreshold}`, {
          min_score: minScore,
          score_diff: scoreDiff,
          escalation_threshold: escalationThreshold,
        });
        sendPipelineNotification("onEscalation", { candidateId: data.application.candidate_id, pipelineName: data.pipeline.name, phaseName: currentPhase.name, score: phaseScore });
        toast.info("Sua avaliação será analisada por um recrutador.");
      } else {
        const maxRetries = data.config.max_retry_attempts;
        const canRetry = maxRetries > 0 && retryCount < maxRetries;

        // Push notification on stage fail (onStageFail event)
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from("notifications").insert({
              event_type: "triage_stage_fail",
              recipient_id: user.id,
              channel: "push",
              title: "Dicas para melhorar",
              body: `Seu score (${phaseScore}) ficou abaixo do mínimo (${minScore}) na fase "${currentPhase.name}". Revise o conteúdo educativo para se preparar melhor.`,
              status: "pending",
            } as any);
          }
        } catch (e) {
          console.error("[Triage] Failed to send stage fail notification:", e);
        }

        if (canRetry) {
          await logProgress(currentPhase.name, phaseScore, "repetir", `score_below_min:${minScore}`, { retries_left: maxRetries - retryCount - 1 });
          toast.info(`Score ${phaseScore} abaixo do mínimo (${minScore}). Você pode tentar novamente.`);
        } else {
          await advancePhase.mutateAsync({ applicationId, status: "standby" });
          await logProgress(currentPhase.name, phaseScore, "standby", `score_below_min:${minScore}+no_retries`);
          sendPipelineNotification("onPhaseFailed", { candidateId: data.application.candidate_id, pipelineName: data.pipeline.name, phaseName: currentPhase.name, score: phaseScore });
          try { const { moveToStandby } = await import("@/lib/moveToStandby"); await moveToStandby(data.application.candidate_id, `Score insuficiente sem retentativas: ${phaseScore}/${minScore}`, data.application.unit_jobs?.job_id); } catch (e) { console.error("[Triage] moveToStandby error:", e); }
          toast.info("Você foi direcionado para a lista de oportunidades.");
        }
      }
    }

    await refetch();
  }, [currentPhase, currentPhaseIndex, data, applicationId, getMinScoreForPhase, applyRounding, logProgress, advancePhase, refetch, visibleSteps, notifyAdminsMaxAttempts]);
  const handleSubmit = useCallback(async (response: any, score?: number) => {
    if (!currentStep || !applicationId || !data) return;

    try {
      // Check max_global_retries (total retries across ALL steps in the process)
      const maxGlobalRetries = data.config.max_global_retries;
      if (maxGlobalRetries > 0) {
        const totalResponses = data.responses.length;
        const totalSteps = data.pipeline.pipeline_phases.reduce(
          (sum: number, p: any) => sum + (p.pipeline_steps?.length || 0), 0
        );
        const globalRetryCount = totalResponses - totalSteps; // responses beyond first attempt per step
        if (globalRetryCount >= maxGlobalRetries) {
          await logProgress(currentPhase?.name || "unknown", null, "max_global_retries_atingido", "max_global_retries", {
            global_retry_count: globalRetryCount,
            max_global_retries: maxGlobalRetries,
          });
          await notifyAdminsMaxAttempts(
            `Candidato atingiu o limite global de ${maxGlobalRetries} retentativa(s) no processo.`,
            { candidate_id: data.application.candidate_id, application_id: applicationId, type: "global" }
          );
          toast.error(`Limite global de ${maxGlobalRetries} retentativa(s) atingido no processo.`);
          return;
        }
      }

      const stepResponses = data.responses.filter((r: any) => r.step_id === currentStep.id);
      const retryCount = stepResponses.length;
      if (retryCount >= data.config.max_retry_attempts && data.config.max_retry_attempts > 0) {
        await logProgress(currentPhase?.name || "unknown", null, "max_tentativas_atingido", "max_retry_attempts", {
          step_id: currentStep.id,
          retry_count: retryCount,
          max_allowed: data.config.max_retry_attempts,
        });
        await notifyAdminsMaxAttempts(
          `Candidato atingiu o limite de ${data.config.max_retry_attempts} tentativa(s) na etapa "${currentStep.title || currentStep.id}".`,
          { candidate_id: data.application.candidate_id, application_id: applicationId, step_id: currentStep.id, type: "step" }
        );
        toast.error(`Limite de ${data.config.max_retry_attempts} tentativa(s) atingido para esta etapa.`);
        return;
      }

      const submittedResponse = await submitResponse.mutateAsync({
        applicationId,
        stepId: currentStep.id,
        response,
        score,
      });

      // Check if this was the last step in the phase
      if (!currentPhase) throw new Error("Fase atual não encontrada");
      const phaseSteps = currentPhase.pipeline_steps;
      const answeredCount = data.responses.filter((r: any) =>
        phaseSteps.some((s: any) => s.id === r.step_id)
      ).length + 1;
      const isLastStep = answeredCount >= phaseSteps.length;

      // Determine if AI evaluation is needed
      const needsAIEval = score === undefined && ["texto", "video", "audio", "imagem"].includes(currentStep.type) && currentStep.type !== "voice";

      if (needsAIEval) {
        setEvaluating(true);
        const stepType = currentStep.type;
        const mediaUrl = response?.file_url || response?.url;

        if (stepType === "texto") {
          toast.info("Avaliação da IA em andamento...");
        } else if (stepType === "video" || stepType === "audio") {
          toast.info("Transcrevendo e avaliando mídia...");
        }

        try {
          const result = await triggerAutoEvaluation(
            submittedResponse.id,
            applicationId,
            stepType === "texto" ? undefined : stepType,
            stepType === "texto" ? undefined : mediaUrl
          );

          if (result?.final_score !== undefined) {
            toast.success(`Avaliação concluída: score ${result.final_score}`);
          }

          // Refetch to get updated scores
          const { data: freshData } = await refetch();

          if (isLastStep && freshData) {
            // Use fresh responses for phase calculation
            const allResponses = freshData.responses;
            await calculateAndAdvancePhase(allResponses, retryCount);
          }
        } catch (e) {
          console.error("AI evaluation error:", e);
          toast.warning("Avaliação IA falhou. O gestor avaliará manualmente.");
          if (isLastStep) {
            // Proceed with whatever scores are available
            const { data: freshData } = await refetch();
            if (freshData) {
              await calculateAndAdvancePhase(freshData.responses, retryCount);
            }
          }
        } finally {
          setEvaluating(false);
        }
      } else {
        // Score already provided (quiz) or no AI needed
        if (isLastStep) {
          const allResponses = [...data.responses, { step_id: currentStep.id, score }];
          await calculateAndAdvancePhase(allResponses, retryCount);
        } else {
          toast.success("Resposta enviada com sucesso!");
          await refetch();
        }
      }
    } catch (e) {
      setEvaluating(false);
      safeToast.error(e);
    }
  }, [currentPhase, currentPhaseIndex, data, applicationId, logProgress, submitResponse, refetch, calculateAndAdvancePhase]);

  const handleSkipOptional = useCallback(async () => {
    if (!currentStep || !applicationId || !data) return;
    try {
      // Submit a "skipped" response with null score
      await submitResponse.mutateAsync({
        applicationId,
        stepId: currentStep.id,
        response: { skipped: true },
        score: undefined,
      });

      const phaseSteps = visibleSteps.length > 0 ? visibleSteps : currentPhase!.pipeline_steps;
      const answeredCount = data.responses.filter((r: any) =>
        phaseSteps.some((s: any) => s.id === r.step_id)
      ).length + 1;
      const isLastStep = answeredCount >= phaseSteps.length;

      if (isLastStep) {
        const { data: freshData } = await refetch();
        if (freshData) {
          await calculateAndAdvancePhase(freshData.responses, 0);
        }
      } else {
        toast.info("Etapa pulada.");
        await refetch();
      }
    } catch (e) {
      safeToast.error(e);
    }
  }, [currentStep, currentPhase, data, applicationId, submitResponse, refetch, calculateAndAdvancePhase, visibleSteps]);

  // Gate hook MUST be called unconditionally (before any early returns) to
  // preserve hook order. Compute flags defensively from possibly-null data.
  const _isPostInterviewPhase =
    (currentPhase as any)?.phase_kind === "avaliacao_pos_entrevista";
  const _hasPendingStepInCurrentPhase = !!currentPhase && !!currentStep;
  const { data: postInterviewUnlocked, isLoading: postInterviewGateLoading } = useQuery({
    queryKey: ["triage-post-interview-gate", applicationId],
    enabled: !!applicationId && _isPostInterviewPhase && _hasPendingStepInCurrentPhase,
    queryFn: () => fetchPostInterviewTestUnlocked(applicationId!),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data || !data.pipeline.pipeline_phases.length) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <Button variant="ghost" onClick={() => navigate("/candidaturas")}>
          <ArrowLeft className="h-4 w-4 mr-2" />Voltar
        </Button>
        <Card><CardContent className="py-8 text-center text-muted-foreground">Pipeline não configurado para esta vaga.</CardContent></Card>
      </div>
    );
  }

  const hasPendingStepInCurrentPhase = _hasPendingStepInCurrentPhase;
  const isPostInterviewPhase = _isPostInterviewPhase;
  const postInterviewLocked =
    isPostInterviewPhase && hasPendingStepInCurrentPhase && postInterviewUnlocked === false;
  // No novo fluxo unificado o teste online é sempre a primeira etapa (obrigatória),
  // portanto nunca é bloqueado por modalidade da unidade.

  const isComplete =
    !(isPostInterviewPhase && hasPendingStepInCurrentPhase && !postInterviewLocked) &&
    (data.application.status === "aprovado" ||
      data.application.status === "standby" ||
      data.application.status === "em_avaliacao");

  // Detecta se uma fase de teste pós-entrevista foi totalmente respondida —
  // nesse caso a tela final NÃO deve oferecer "Agende sua entrevista"
  // (a entrevista já aconteceu). Mostra card próprio "Respostas enviadas".
  const answeredStepIdSet = new Set(data.responses.map((r: any) => r.step_id));
  const postInterviewPhaseAnswered = data.pipeline.pipeline_phases.some((p: any) => {
    if (p.phase_kind !== "avaliacao_pos_entrevista") return false;
    const steps = (p.pipeline_steps || []).filter((s: any) => !s.is_optional);
    if (steps.length === 0) return false;
    return steps.every((s: any) => answeredStepIdSet.has(s.id));
  });
  const showPostInterviewSubmitted =
    postInterviewPhaseAnswered &&
    !isApprovedPendingDocs &&
    (data.application.status === "em_avaliacao" || data.application.status === "aprovado");


  return (
    <div className="px-4 pt-6 pb-24 space-y-6 max-w-lg mx-auto">
      <Button variant="ghost" size="sm" onClick={() => navigate("/candidaturas")}>
        <ArrowLeft className="h-4 w-4 mr-2" />Voltar
      </Button>

      {!hasConsent && !isComplete ? (
        <AIConsentGate
          onAccept={() => { void grantConsent(); }}
          onDecline={() => {
            toast.info("Você recusou o processamento por IA. Fale com o recrutador para prosseguir.");
            navigate("/candidaturas");
          }}
        />
      ) : evaluating ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Loader2 className="h-12 w-12 text-primary mx-auto animate-spin" />
            <h2 className="text-lg font-semibold text-foreground">Avaliando sua resposta...</h2>
            <p className="text-sm text-muted-foreground">A IA está analisando sua resposta. Aguarde alguns instantes.</p>
          </CardContent>
        </Card>
      ) : isPostInterviewPhase && postInterviewGateLoading ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Loader2 className="h-12 w-12 text-primary mx-auto animate-spin" />
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </CardContent>
        </Card>
      ) : postInterviewLocked ? (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <Clock className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Aguardando aprovação na entrevista</h2>
            <p className="text-muted-foreground">
              O teste desta etapa só fica disponível depois que a unidade aprovar
              sua entrevista. Você recebe um aviso aqui assim que liberar.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/candidaturas")}>
              Voltar às Candidaturas
            </Button>
          </CardContent>
        </Card>
      ) : isComplete ? (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            {showPostInterviewSubmitted ? (
              <>
                <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
                <h2 className="text-xl font-bold text-foreground">Teste online concluído!</h2>
                <p className="text-muted-foreground">
                  Você concluiu o teste online com sucesso. A próxima etapa é o{" "}
                  <strong>teste presencial</strong> na unidade. Agende agora o melhor dia e
                  horário conforme a disponibilidade da unidade.
                </p>
                <div className="flex flex-col gap-2 items-center">
                  <Button size="sm" onClick={() => setPresencialOpen(true)}>
                    <CalendarPlus className="h-4 w-4 mr-1" />
                    Agendar teste presencial
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/candidaturas")}>
                    Voltar às Candidaturas
                  </Button>
                </div>
              </>
            ) : data.application.status === "aprovado" ? (

              <>
                <CheckCircle2 className={`h-12 w-12 mx-auto ${isApprovedPendingDocs ? "text-yellow-500" : "text-success"}`} />
                <h2 className="text-xl font-bold text-foreground">
                  {isApprovedPendingDocs
                    ? "Você foi aprovado nessa etapa (Aguardando documentação)"
                    : activeInterview
                      ? "Aprovado! Entrevista agendada"
                      : canSelfSchedule
                        ? "Aprovado! Agende sua entrevista"
                        : "Aprovado!"}
                </h2>
                <p className="text-muted-foreground">
                  {isApprovedPendingDocs
                    ? "Você foi aprovado nessa etapa (Aguardando documentação)."
                    : activeInterview
                      ? "Sua entrevista já está agendada. Acompanhe pelas candidaturas."
                      : canSelfSchedule
                        ? "Parabéns! Você passou na triagem. Escolha o melhor horário para sua entrevista."
                        : "Parabéns, você completou todas as etapas com sucesso."}
                </p>
                {data.application.total_score && <p className="text-lg font-semibold">Score: {data.application.total_score}</p>}
                {isApprovedPendingDocs ? (
                  <Button size="sm" onClick={() => navigate(`/documentos/${applicationId}`)}>
                    Enviar Documentos
                  </Button>
                ) : canSelfSchedule && !activeInterview ? (
                  <div className="flex flex-col gap-2 items-center">
                    <Button size="sm" onClick={() => setSchedulerOpen(true)}>
                      <CalendarPlus className="h-4 w-4 mr-1" />
                      Agendar Entrevista
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => navigate("/candidaturas")}>
                      Voltar às Candidaturas
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => navigate("/candidaturas")}>
                    Voltar às Candidaturas
                  </Button>
                )}
              </>
            ) : data.application.status === "em_avaliacao" ? (
              <>
                <Clock className="h-12 w-12 text-purple-500 mx-auto" />
                <h2 className="text-xl font-bold text-foreground">Aguardando análise do recrutador</h2>
                <p className="text-muted-foreground">
                  Você concluiu o teste. Nossa equipe está analisando suas respostas e em breve você receberá uma resposta.
                </p>
                {data.application.total_score && <p className="text-lg font-semibold">Score: {data.application.total_score}</p>}
                <Button variant="outline" size="sm" onClick={() => navigate("/candidaturas")}>
                  Voltar às Candidaturas
                </Button>
              </>
            ) : (
              <>
                <Clock className="h-12 w-12 text-yellow-500 mx-auto" />
                <h2 className="text-xl font-bold text-foreground">Disponível para novas oportunidades</h2>
                <p className="text-muted-foreground">Seu perfil foi registrado no nosso banco de talentos. Você será notificado quando surgirem vagas compatíveis.</p>
                <Button variant="outline" size="sm" onClick={() => navigate("/banco-talentos")}>
                  Ver Banco de Talentos
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : currentPhase && currentStep ? (
        <>
          <TriageProgressBar
            currentPhaseIndex={currentPhaseIndex}
            totalPhases={data.pipeline.pipeline_phases.length}
            currentStepIndex={currentStepIndex}
            totalSteps={visibleSteps.length || currentPhase.pipeline_steps.length}
            phaseName={currentPhase.name}
          />

          {currentStep.is_optional && (
            <div className="flex items-center justify-between bg-accent/50 rounded-lg p-3">
              <span className="text-sm text-muted-foreground">Esta etapa é opcional</span>
              <Button variant="ghost" size="sm" onClick={handleSkipOptional} disabled={submitResponse.isPending}>
                Pular etapa
              </Button>
            </div>
          )}

          {finalizingBlock || (submitResponse.isPending && intraStepIdx === (getStepQuestions(currentStep).length - 1)) ? (
            <Card>
              <CardContent className="py-12 text-center space-y-4">
                <Loader2 className="h-12 w-12 text-primary mx-auto animate-spin" />
                <h2 className="text-lg font-semibold text-foreground">Enviando suas respostas...</h2>
                <p className="text-sm text-muted-foreground">
                  Já recebemos e estamos processando. Não feche esta tela.
                </p>
              </CardContent>
            </Card>
          ) : (() => {
            const questions = getStepQuestions(currentStep);
            const safeIdx = Math.min(intraStepIdx, questions.length - 1);
            const q = questions[safeIdx];
            if (!q) return null;
            const isMulti = questions.length > 1;
            const displayTitle = isMulti
              ? `${currentStep.title} · Pergunta ${safeIdx + 1} de ${questions.length}`
              : currentStep.title;

            // Quando UMA pergunta termina dentro do bloco, decidimos:
            // - se é a última do bloco -> consolida e chama handleSubmit (única gravação em step_responses)
            // - se não é -> guarda local e avança intra-step
            const onQuestionAnswered = (response: any, score: number, weight: number) => {
              const newAnswers = {
                ...intraAnswers,
                [q.id]: { response, score, weight },
              };
              if (safeIdx + 1 < questions.length) {
                setIntraAnswers(newAnswers);
                setIntraStepIdx(safeIdx + 1);
                return;
              }
              // Último: consolida
              const list = questions.map((qq: any) => newAnswers[qq.id]).filter(Boolean) as any[];
              const consolidated = consolidateStepScore(list);
              const breakdown = questions.map((qq: any) => ({
                question_id: qq.id,
                type: qq.type,
                prompt: qq.prompt,
                ...(newAnswers[qq.id] || { response: null, score: 0, weight: qq.weight || 1 }),
              }));
              // NÃO resetamos intraStepIdx aqui — se resetássemos, o candidato
              // veria a "Pergunta 1" reaparecer enquanto o servidor processa.
              // O reset acontece no useEffect quando currentStep muda.
              setFinalizingBlock(true);
              handleSubmit({ multi_question: true, breakdown, answers: newAnswers }, consolidated);
            };

            const qWeight = Number(q.weight) || ((q.type === "quiz" || q.type === "true_false") ? 1 : 2);

            const backButton = isMulti && safeIdx > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIntraStepIdx(safeIdx - 1)}
                disabled={submitResponse.isPending || evaluating}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Pergunta anterior
              </Button>
            ) : null;

            return (
              <div className="space-y-3">
                {backButton}
                {q.type === "texto" && (
                  <TextStep
                    key={`${currentStep.id}-${q.id}`}
                    title={displayTitle}
                    content={{ prompt: q.prompt }}
                    onSubmit={(resp) => onQuestionAnswered(resp, 0, qWeight)}
                    isSubmitting={submitResponse.isPending || evaluating}
                  />
                )}
                {q.type === "quiz" && (
                  <QuizStep
                    key={`${currentStep.id}-${q.id}`}
                    title={displayTitle}
                    content={{ question: q.prompt, options: q.options || [] }}
                    onSubmit={(resp) => {
                      const idx = (resp as any)?.selected_index;
                      const opt = (q.options || [])[idx];
                      const score = opt ? quizScoreFromOption(opt) : 50;
                      onQuestionAnswered(resp, score, qWeight);
                    }}
                    isSubmitting={submitResponse.isPending}
                  />
                )}
                {q.type === "true_false" && (() => {
                  // Migração inline: se vier do formato antigo (options [V,F]) cria 1 afirmativa única.
                  const statements: Array<{ id: string; text: string; correct: boolean }> =
                    Array.isArray(q.statements) && q.statements.length > 0
                      ? q.statements
                      : (Array.isArray(q.options) && q.options.length === 2
                          ? [{ id: "s1", text: q.prompt || "", correct: q.options.find((o: any) => o?.text === "Verdadeiro")?.weight === "alto" }]
                          : [{ id: "s1", text: q.prompt || "", correct: false }]);
                  return (
                    <TrueFalseMultiStep
                      key={`${currentStep.id}-${q.id}`}
                      title={displayTitle}
                      prompt={q.prompt}
                      statements={statements}
                      onSubmit={(resp, score) => onQuestionAnswered(resp, score, qWeight)}
                      isSubmitting={submitResponse.isPending}
                    />
                  );
                })()}
                {q.type === "imagem" && Array.isArray(q.options) && q.options.some((o: any) => o?.image_url || o?.url) ? (
                  <ImageChoiceStep
                    key={`${currentStep.id}-${q.id}`}
                    title={displayTitle}
                    prompt={q.prompt || q.question || q.instructions}
                    options={q.options}
                    onSubmit={(resp, score) => onQuestionAnswered(resp, score, qWeight)}
                    isSubmitting={submitResponse.isPending || evaluating}
                  />
                ) : (q.type === "video" || q.type === "audio" || q.type === "imagem") && (
                  <MediaStep
                    key={`${currentStep.id}-${q.id}`}
                    title={displayTitle}
                    type={q.type as "video" | "audio" | "imagem"}
                    content={{ prompt: q.prompt, url: q.url }}
                    onSubmit={(resp) => onQuestionAnswered(resp, 100, qWeight)}
                    isSubmitting={submitResponse.isPending || evaluating}
                    applicationId={applicationId!}
                    candidateId={data.application.candidate_id}
                    questionIndex={safeIdx}
                  />
                )}
                {q.type === "voice" && (
                  <VoiceRecordingStep
                    key={`${currentStep.id}-${q.id}`}
                    title={displayTitle}
                    content={{
                      question: q.prompt,
                      questions: [{ id: q.id, text: q.prompt, max_seconds: q.max_seconds || 120, weight: qWeight }],
                    }}
                    stepId={`${currentStep.id}_${q.id}`}
                    applicationId={applicationId!}
                    onSubmit={(resp, score) => onQuestionAnswered(resp, score ?? 50, qWeight)}
                    isSubmitting={submitResponse.isPending || evaluating}
                  />
                )}
                {q.type === "entrevista_voz" && (
                  <VoiceInterviewStep
                    key={`${currentStep.id}-${q.id}`}
                    title={displayTitle}
                    content={currentStep.content as any}
                    stepId={currentStep.id}
                    applicationId={applicationId!}
                    onSubmit={(resp, score) => onQuestionAnswered(resp, score ?? 50, qWeight)}
                    isSubmitting={submitResponse.isPending}
                  />
                )}
              </div>
            );
          })()}
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            {currentPhase && classifyPhase(currentPhase.name) === "Entrevista" ? (
              <>
                <CalendarPlus className="h-12 w-12 text-primary mx-auto" />
                <h2 className="text-lg font-semibold text-foreground">Fase de Entrevista</h2>
                <p className="text-muted-foreground">Você avançou para a etapa de entrevista! Vá para suas candidaturas para agendar.</p>
                <Button size="sm" onClick={() => navigate("/candidaturas")}>
                  Ver Candidaturas
                </Button>
              </>
            ) : (
              <>
                <AlertTriangle className="h-12 w-12 text-warning mx-auto" />
                <p className="text-muted-foreground">Todas as etapas desta fase foram respondidas. Aguarde o resultado.</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {data?.application?.status === "aprovado" && canSelfSchedule && !activeInterview && !showPostInterviewSubmitted && (
        <InterviewScheduler
          applicationId={applicationId!}
          unitId={(data.application as any).unit_jobs?.unit_id}
          candidateId={(data.application as any).candidate_id}
          jobTitle={(data.application as any).unit_jobs?.jobs?.title}
          jobDescription={(data.application as any).unit_jobs?.jobs?.description}
          jobId={(data.application as any).unit_jobs?.jobs?.id}
          open={schedulerOpen}
          onOpenChange={setSchedulerOpen}
          onScheduled={() => { setSchedulerOpen(false); refetch(); }}
        />
      )}

      {/* Agendamento do teste presencial — logo após concluir o teste online */}
      {showPostInterviewSubmitted && (data.application as any).unit_jobs?.unit_id && (
        <TestScheduleDialog
          open={presencialOpen}
          onOpenChange={setPresencialOpen}
          testAssignmentId={null}
          applicationId={applicationId!}
          unitId={(data.application as any).unit_jobs?.unit_id}
          onBooked={() => { setPresencialOpen(false); refetch(); }}
        />
      )}
    </div>
  );
}
