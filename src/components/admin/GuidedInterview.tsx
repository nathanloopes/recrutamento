import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGuideForJob, useSubmitFeedback, useInterviewFeedback } from "@/hooks/useInterviewGuides";
import { useUpdateInterview } from "@/hooks/useScheduling";
import { useSendNotification } from "@/hooks/useNotifications";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, ShieldAlert, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { releasePostInterviewTest } from "@/lib/releasePostInterviewTest";
import { useUnitTestConfig } from "@/hooks/useTestBookings";

function useInterviewGuideConfig() {
  const { data: settings } = useGlobalSettings("interview_guide");
  if (!settings) return null;
  const get = (key: string) => settings.find(s => s.key === key)?.value;
  return {
    enableInterviewGuides: get("enable_interview_guides") !== false,
    requireDecision: get("require_decision") !== false,
    allowEditAfterSubmit: get("allow_edit_after_submit") === true,
    aiAssistEnabled: get("ai_assist_enabled") !== false,
    defaultStandbyPool: get("default_standby_pool") !== false,
  };
}

interface GuidedInterviewProps {
  interview: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

const CRITERIA_SCALES = [
  { value: "alto", label: "Alto", color: "text-green-600" },
  { value: "medio", label: "Médio", color: "text-yellow-600" },
  { value: "baixo", label: "Baixo", color: "text-red-600" },
];

// Normaliza valores legados de avaliação para a nova escala (alto/medio/baixo)
// Cobre tanto critérios (adequado/atencao/critico) quanto perguntas (respondida/parcial/nao_respondida)
const LEGACY_CRITERIA_MAP: Record<string, string> = {
  adequado: "alto",
  atencao: "medio",
  critico: "baixo",
  respondida: "alto",
  parcial: "medio",
  nao_respondida: "baixo",
};
function normalizeCriterionValue(v: string | undefined | null): string {
  if (!v) return "";
  return LEGACY_CRITERIA_MAP[v] || v;
}

function getQuestionText(question: any): string {
  return String(question?.text || question?.label || "").trim();
}

function getQuestionCriterionId(block: any, question: any): string | null {
  return question?.criterion_id || block?.criteria?.[0]?.id || null;
}

const DECISIONS = [
  { value: "presencial", label: "Próxima Etapa", icon: CheckCircle2, color: "text-green-600" },
  { value: "standby", label: "Standby", icon: AlertTriangle, color: "text-yellow-600" },
  { value: "encerrado", label: "Encerramento", icon: XCircle, color: "text-red-600" },
];

export function GuidedInterview({ interview, open, onOpenChange, readOnly = false }: GuidedInterviewProps) {
  const jobId = interview?.applications?.unit_jobs?.jobs?.id;
  const unitId = interview?.unit_id || interview?.applications?.unit_jobs?.unit_id;
  const guideConfig = useInterviewGuideConfig();
  const { data: guide, isLoading: guideLoading } = useGuideForJob(jobId);
  const { data: existingFeedback } = useInterviewFeedback(readOnly ? interview?.id : undefined);
  const { data: unitTestCfg } = useUnitTestConfig(unitId);
  const submitFeedback = useSubmitFeedback();
  const updateInterview = useUpdateInterview();
  const sendNotification = useSendNotification();
  const { user, isAdmin } = useAuth();

  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [criteriaAnswers, setCriteriaAnswers] = useState<Record<string, string>>({});
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [showCoherenceAlert, setShowCoherenceAlert] = useState(false);
  const [showTestReleaseConfirm, setShowTestReleaseConfirm] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);

  // Auto-save: rascunho local por entrevista (não persiste no banco até finalizar)
  const draftKey = interview?.id ? `guided_interview_draft:${interview.id}` : null;
  const draftLoadedRef = useRef(false);

  // Carrega rascunho ao abrir
  useEffect(() => {
    if (!open || readOnly || !draftKey || draftLoadedRef.current) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.questionAnswers) setQuestionAnswers(d.questionAnswers);
        if (d.criteriaAnswers) setCriteriaAnswers(d.criteriaAnswers);
        if (d.observations) setObservations(d.observations);
        if (d.decision) setDecision(d.decision);
        if (d.notes) setNotes(d.notes);
        if (d.savedAt) setAutoSavedAt(new Date(d.savedAt));
      }
    } catch (e) { console.error("[GuidedInterview] draft load error:", e); }
    draftLoadedRef.current = true;
  }, [open, readOnly, draftKey]);

  // Salva rascunho com debounce
  useEffect(() => {
    if (!open || readOnly || !draftKey || !draftLoadedRef.current) return;
    const hasAny =
      Object.keys(questionAnswers).length > 0 ||
      Object.keys(criteriaAnswers).length > 0 ||
      Object.keys(observations).length > 0 ||
      decision || notes;
    if (!hasAny) return;
    const t = setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({
          questionAnswers, criteriaAnswers, observations, decision, notes, savedAt,
        }));
        setAutoSavedAt(new Date(savedAt));
      } catch (e) { console.error("[GuidedInterview] draft save error:", e); }
    }, 600);
    return () => clearTimeout(t);
  }, [open, readOnly, draftKey, questionAnswers, criteriaAnswers, observations, decision, notes]);


  // P1 Guard: if enable_interview_guides is false, block access
  const guidesDisabled = guideConfig && guideConfig.enableInterviewGuides === false;

  // Gap 5: RBAC — validate interviewer_id (only designated interviewer or admin/rh can submit)
  const isDesignatedInterviewer = interview?.interviewer_id === user?.id;
  const isAdminOrRH = isAdmin;
  const interviewerBlocked = !readOnly && !isDesignatedInterviewer && !isAdminOrRH;

  // P1 Guard: if allow_edit_after_submit is false, check existing feedback
  const hasExistingFeedback = !!existingFeedback;
  const editBlocked = !readOnly && hasExistingFeedback && guideConfig?.allowEditAfterSubmit === false;

  const blocks = readOnly
    ? existingFeedback?.interview_guides?.guide_json?.blocks || []
    : guide?.guide_json?.blocks || [];

  const feedbackData = existingFeedback?.checklist_json || {};

  // Escala de score
  const SCALE_TO_SCORE: Record<string, number> = { alto: 100, medio: 60, baixo: 20 };
  const scoreToLevel = (score: number): "alto" | "medio" | "baixo" =>
    score >= 75 ? "alto" : score >= 45 ? "medio" : "baixo";

  // Breakdown por critério: agrupa perguntas por criterion_id e calcula % média.
  const criteriaBreakdown = useMemo(() => {
    const source = readOnly ? (feedbackData?.questions || {}) : questionAnswers;
    const result: { blockName: string; criterionId: string; label: string; percent: number | null; level: string | null; answered: number; total: number }[] = [];
    for (const block of blocks) {
      for (const c of (block.criteria || [])) {
        const linked = (block.questions || []).filter((q: any) =>
          getQuestionText(q) && getQuestionCriterionId(block, q) === c.id
        );
        const scores = linked
          .map((q: any) => SCALE_TO_SCORE[normalizeCriterionValue((source as any)[q.id])])
          .filter((n: any) => typeof n === "number");
        const percent = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;
        result.push({
          blockName: block.name,
          criterionId: c.id,
          label: c.label || "—",
          percent,
          level: percent == null ? null : scoreToLevel(percent),
          answered: scores.length,
          total: linked.length,
        });
      }
      if ((!block.criteria || block.criteria.length === 0) && (block.questions || []).some((q: any) => getQuestionText(q))) {
        const linked = (block.questions || []).filter((q: any) => getQuestionText(q));
        const scores = linked
          .map((q: any) => SCALE_TO_SCORE[normalizeCriterionValue((source as any)[q.id])])
          .filter((n: any) => typeof n === "number");
        const percent = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;
        result.push({
          blockName: block.name,
          criterionId: `block:${block.name}`,
          label: block.name || "Critério do bloco",
          percent,
          level: percent == null ? null : scoreToLevel(percent),
          answered: scores.length,
          total: linked.length,
        });
      }
    }
    return result;
  }, [blocks, readOnly, feedbackData, questionAnswers]);

  // Auto-deriva criteriaAnswers a partir das respostas das perguntas (mesmo nível da resposta).
  useEffect(() => {
    if (readOnly) return;
    const derived: Record<string, string> = {};
    for (const item of criteriaBreakdown) {
      if (item.level) derived[item.criterionId] = item.level;
    }
    setCriteriaAnswers((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(derived)]);
      let changed = false;
      const next: Record<string, string> = { ...prev };
      for (const k of keys) {
        if (derived[k] !== prev[k]) {
          changed = true;
          if (derived[k] === undefined) delete next[k];
          else next[k] = derived[k];
        }
      }
      return changed ? next : prev;
    });
  }, [criteriaBreakdown, readOnly]);

  // Progresso baseado apenas em perguntas (critério é derivado).
  const evaluableQuestions = blocks.flatMap((b: any) => b.questions || []).filter((q: any) => getQuestionText(q));
  const totalItems = evaluableQuestions.length;
  const answeredItems = evaluableQuestions.filter((q: any) => questionAnswers[q.id]).length;
  const progress = totalItems > 0 ? Math.round((answeredItems / totalItems) * 100) : 0;

  // Coherence detection
  const normalizedCriteria = criteriaBreakdown.map(c => c.level).filter(Boolean) as string[];
  const hasCriticalCriteria = normalizedCriteria.some(v => v === "baixo");
  const isAdvancingDecision = decision === "presencial";

  const unansweredQuestionCount = evaluableQuestions.filter((q: any) => !questionAnswers[q.id]).length;
  const partialAnswerCount = Object.values(questionAnswers).filter(v => v === "parcial").length;
  const notAnsweredCount = Object.values(questionAnswers).filter(v => v === "nao_respondida").length;
  const attentionCriteriaCount = normalizedCriteria.filter(v => v === "medio").length;
  const criticalCriteriaCount = normalizedCriteria.filter(v => v === "baixo").length;

  const riskScore = (criticalCriteriaCount * 3) + (attentionCriteriaCount * 1) + (notAnsweredCount * 2) + (partialAnswerCount * 1);
  const hasEvasivePattern = notAnsweredCount >= 2 || partialAnswerCount >= 3;
  const hasHighRisk = riskScore >= 5;

  // Nota média — agora somente das perguntas (critério = mesma resposta, não duplica peso).
  const recruiterAverage = useMemo(() => {
    const source = readOnly ? (feedbackData?.questions || {}) : questionAnswers;
    const values = Object.values(source as Record<string, string>)
      .map((v) => SCALE_TO_SCORE[normalizeCriterionValue(v)])
      .filter((n) => typeof n === "number");
    if (values.length === 0) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }, [readOnly, feedbackData, questionAnswers]);
  const averageLabel = recruiterAverage == null
    ? "—"
    : recruiterAverage >= 75 ? "Alto" : recruiterAverage >= 45 ? "Médio" : "Baixo";
  const averageColor = recruiterAverage == null
    ? "text-muted-foreground"
    : recruiterAverage >= 75 ? "text-green-600" : recruiterAverage >= 45 ? "text-yellow-600" : "text-red-600";

  // Validação
  const requiredQuestions = blocks.flatMap((b: any) => (b.questions || []).filter((q: any) => getQuestionText(q) && q.required));
  const allRequiredAnswered = requiredQuestions.every((q: any) => questionAnswers[q.id]);
  const allCriteriaAnswered = true; // Derivado automaticamente

  const handleFinalizeClick = () => {
    // P1 Guard: require_decision from config
    if (guideConfig?.requireDecision !== false && !decision) { toast.error("Selecione uma decisão"); return; }
    if (!decision) { toast.error("Selecione uma decisão"); return; }
    // P2: Validate minimum checklist completion
    if (!allRequiredAnswered) { toast.error("Responda todas as perguntas obrigatórias"); return; }
    if (!allCriteriaAnswered) { toast.error("Preencha todos os critérios de avaliação"); return; }
    if (guideConfig?.aiAssistEnabled && (hasCriticalCriteria || hasHighRisk || hasEvasivePattern) && isAdvancingDecision) {
      setShowCoherenceAlert(true);
      return;
    }
    // Confirma liberação de teste pós-entrevista quando a unidade tem teste configurado
    if (decision === "presencial" && unitTestCfg?.enabled) {
      setShowTestReleaseConfirm(true);
      return;
    }
    handleFinalize();
  };

  const handleFinalize = async () => {
    if (!decision) { toast.error("Selecione uma decisão"); return; }
    if (!user?.id) return;
    setShowCoherenceAlert(false);

    // P2: Log to activity_logs on finalize (includes AI risk analysis)
    try {
      await supabase.from("activity_logs").insert({
        user_id: user.id,
        action: "interview_finalized",
        module: "entrevista_guiada",
        details: {
          interview_id: interview.id,
          application_id: interview.application_id,
          decision,
          candidate_id: interview?.candidate_id,
          criteria_count: Object.keys(criteriaAnswers).length,
          has_critical: hasCriticalCriteria,
          ai_risk_analysis: {
            risk_score: riskScore,
            has_high_risk: hasHighRisk,
            has_evasive_pattern: hasEvasivePattern,
            critical_criteria_count: criticalCriteriaCount,
            attention_criteria_count: attentionCriteriaCount,
            not_answered_count: notAnsweredCount,
            partial_answer_count: partialAnswerCount,
          },
        },
      });
    } catch (e) { console.error("[GuidedInterview] activity_log error:", e); }

    // Build AI risk analysis payload for persistence
    const aiRiskAnalysis = {
      risk_score: riskScore,
      has_high_risk: hasHighRisk,
      has_evasive_pattern: hasEvasivePattern,
      has_critical_criteria: hasCriticalCriteria,
      critical_criteria_count: criticalCriteriaCount,
      attention_criteria_count: attentionCriteriaCount,
      not_answered_count: notAnsweredCount,
      partial_answer_count: partialAnswerCount,
      unanswered_question_count: unansweredQuestionCount,
      coherence_alert_shown: hasCriticalCriteria && isAdvancingDecision,
    };

    try {
      // Submit feedback with AI risk analysis persisted in checklist_json
      await submitFeedback.mutateAsync({
        interview_id: interview.id,
        evaluator_id: user.id,
        guide_id: guide?.id,
        checklist_json: { questions: questionAnswers, criteria: criteriaAnswers, observations, ai_risk_analysis: aiRiskAnalysis },
        decision,
        notes,
      });

      // Update interview status
      await updateInterview.mutateAsync({ id: interview.id, status: "completed" });

      // Update application status based on decision
      if (decision === "standby") {
        await supabase
          .from("applications")
          .update({ status: "standby" } as any)
          .eq("id", interview.application_id);

        const candidateId = interview?.candidate_id;
        const unitId = interview?.unit_id;
        const jobId = interview?.applications?.unit_jobs?.jobs?.id;
        if (candidateId && guideConfig?.defaultStandbyPool !== false) {
          await supabase
            .from("talent_pool_entries")
            .update({
              status: "on_hold",
              standby_reason: notes || "Standby via entrevista guiada",
              last_job_id: jobId || null,
              origin_unit_id: unitId || null,
              last_interaction: new Date().toISOString(),
            } as any)
            .eq("candidate_id", candidateId);

          sendNotification.mutate({
            eventType: "candidate_standby",
            recipientId: candidateId,
            payload: {
              nome: interview?.profiles?.full_name || "",
              cargo: interview?.applications?.unit_jobs?.jobs?.title || "",
              _title: "Candidatura em standby",
              _body: `Sua candidatura para a vaga ${interview?.applications?.unit_jobs?.jobs?.title || ""} foi colocada em standby. Entraremos em contato em breve.`,
            },
          });
        }
      } else if (decision === "presencial") {
        await supabase
          .from("applications")
          .update({ status: "aprovado" } as any)
          .eq("id", interview.application_id);

        // Tentar liberar teste pós-entrevista (no-op se a unidade não tem teste)
        let releaseInfo: Awaited<ReturnType<typeof releasePostInterviewTest>> | null = null;
        try {
          releaseInfo = await releasePostInterviewTest(interview.application_id);
          if (releaseInfo && releaseInfo.released === false) {
            if (releaseInfo.reason === "no_template_for_job") {
              toast.warning("Teste não foi enviado: nenhum modelo de teste vinculado a este cargo. Crie/vincule no Construtor de Testes.");
            } else if (releaseInfo.reason === "insert_failed") {
              toast.error("Falha ao criar o teste para o candidato. Verifique permissões e tente reenviar.");
            }
          }
        } catch (e) {
          console.error("[GuidedInterview] release test failed", e);
        }

        // NÃO criar document_request automaticamente. A etapa Documentação só
        // pode existir após o admin enviar a solicitação oficial via
        // DocumentRequestDialog (regra: zero avanço automático).
        const candidateId = interview?.candidate_id;
        if (candidateId) {
          const jobTitle = interview?.applications?.unit_jobs?.jobs?.title || "";
          const testHint = releaseInfo?.released
            ? releaseInfo.modality === "online"
              ? " Próxima etapa: realizar o teste online pelo app."
              : releaseInfo.modality === "presencial"
                ? " Próxima etapa: agendar o teste presencial pelo app."
                : " Próxima etapa: realizar o teste (online ou presencial — você escolhe pelo app)."
            : "";
          sendNotification.mutate({
            eventType: "candidate_approved",
            recipientId: candidateId,
            payload: {
              nome: interview?.profiles?.full_name || "",
              cargo: jobTitle,
              _title: releaseInfo?.released ? "Aprovado! Hora do teste \ud83d\udcdd" : "Aprovado! \ud83c\udf89",
              _body: `Parabéns! Você foi aprovado(a) para a vaga ${jobTitle}.${testHint}`,
            },
          });
        }
      } else if (decision === "encerrado") {
        await supabase
          .from("applications")
          .update({ status: "standby" } as any)
          .eq("id", interview.application_id);

        // Move to talent pool
        const candidateId = interview?.candidate_id;
        if (candidateId) {
          try {
            const { moveToStandby } = await import("@/lib/moveToStandby");
            await moveToStandby(candidateId, "Decisão do franqueado na entrevista guiada", interview?.applications?.unit_jobs?.job_id);
          } catch (e) { console.error("[GuidedInterview] moveToStandby error:", e); }

          sendNotification.mutate({
            eventType: "candidate_standby",
            recipientId: candidateId,
            payload: {
              nome: interview?.profiles?.full_name || "",
              cargo: interview?.applications?.unit_jobs?.jobs?.title || "",
              _title: "Candidatura em lista de oportunidades",
              _body: `Você foi direcionado para a lista de oportunidades para a vaga ${interview?.applications?.unit_jobs?.jobs?.title || ""}. Entraremos em contato caso surjam novas vagas.`,
            },
          });
        }
      }

      // Gap 4: Fire-and-forget AI summary generation if ai_assist is enabled
      if (guideConfig?.aiAssistEnabled) {
        supabase.functions.invoke("summarize-interview-ai", {
          body: { interview_id: interview.id },
        }).then(({ data, error }) => {
          if (error) {
            console.error("[GuidedInterview] AI summary error:", error);
          } else {
            console.log("[GuidedInterview] AI summary generated:", data);
          }
        }).catch((e) => {
          console.error("[GuidedInterview] AI summary invoke error:", e);
        });
      }

      toast.success("Entrevista finalizada com sucesso!");
      if (draftKey) { try { localStorage.removeItem(draftKey); } catch {} }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!open) return null;

  // P1 Guard: block access if interview guides are disabled
  if (guidesDisabled && !readOnly) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Entrevista Guiada Desativada</DialogTitle>
          </DialogHeader>
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Módulo desativado</AlertTitle>
            <AlertDescription>O módulo de entrevista guiada está desativado no CrossConfig. Contate o administrador.</AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  // Gap 5: Block access if user is not the designated interviewer and not admin
  if (interviewerBlocked) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Acesso restrito</DialogTitle>
          </DialogHeader>
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Entrevistador não autorizado</AlertTitle>
            <AlertDescription>Apenas o entrevistador designado ou administradores podem registrar feedback desta entrevista.</AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  // P1 Guard: block editing if already submitted and editing not allowed
  if (editBlocked) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Feedback já registrado</DialogTitle>
          </DialogHeader>
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Edição bloqueada</AlertTitle>
            <AlertDescription>Já existe um feedback registrado para esta entrevista e a edição pós-submissão está desativada.</AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? "Feedback da Entrevista" : "Entrevista Guiada"}
            {interview?.profiles?.full_name && ` — ${interview.profiles.full_name}`}
          </DialogTitle>
        </DialogHeader>

        {guideLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !blocks.length ? (
          <p className="text-muted-foreground text-center py-8">
            {readOnly ? "Nenhum feedback registrado." : "Nenhum roteiro encontrado para este cargo. Cadastre um roteiro primeiro."}
          </p>
        ) : (
          <div className="space-y-6">
            {!readOnly && (
              <div>
                <Label className="text-sm text-muted-foreground">Progresso</Label>
                <Progress value={progress} className="mt-1" />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted-foreground">{progress}% preenchido</p>
                  {autoSavedAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      Rascunho salvo {autoSavedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              </div>
            )}

            {blocks.map((block: any, bIdx: number) => (
              <Card key={bIdx}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{block.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Questions */}
                  {(block.questions || []).filter((q: any) => getQuestionText(q)).map((q: any) => (
                    <div key={q.id} className="space-y-2 rounded-md border border-border/60 p-3">
                      <div className="flex items-start gap-2">
                        <p className="text-sm flex-1">
                          {getQuestionText(q)}
                          {q.required && <span className="text-destructive ml-1">*</span>}
                        </p>
                      </div>
                      {readOnly ? (
                        <Badge variant="outline">
                          {(() => {
                            const norm = normalizeCriterionValue(feedbackData.questions?.[q.id]);
                            return CRITERIA_SCALES.find((s) => s.value === norm)?.label || "—";
                          })()}
                        </Badge>
                      ) : (
                        <Select
                          value={normalizeCriterionValue(questionAnswers[q.id])}
                          onValueChange={(v) => setQuestionAnswers({ ...questionAnswers, [q.id]: v })}
                        >
                          <SelectTrigger className="w-[180px] h-9">
                            <SelectValue placeholder="Selecionar nível" />
                          </SelectTrigger>
                          <SelectContent>
                            {CRITERIA_SCALES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                <span className={s.color}>{s.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ))}

                  {/* Criteria — em modo edição, o critério é derivado automaticamente da resposta;
                      só renderiza no modo somente-leitura para manter compatibilidade com feedbacks legados */}
                  {readOnly && block.criteria?.map((c: any) => (
                    <div key={c.id} className="space-y-2">
                      <Label className="text-sm font-medium">{c.label}</Label>
                      <Badge variant="outline">
                        {(() => {
                          const norm = normalizeCriterionValue(feedbackData.criteria?.[c.id]);
                          return CRITERIA_SCALES.find((s) => s.value === norm)?.label || "—";
                        })()}
                      </Badge>
                    </div>
                  ))}

                  {/* Observation */}
                  {readOnly ? (
                    feedbackData.observations?.[block.name] && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Observação</Label>
                        <p className="text-sm">{feedbackData.observations[block.name]}</p>
                      </div>
                    )
                  ) : (
                    <div>
                      <Label className="text-xs text-muted-foreground">Observação sobre {block.name}</Label>
                      <Textarea
                        value={observations[block.name] || ""}
                        onChange={(e) => setObservations({ ...observations, [block.name]: e.target.value })}
                        placeholder="Observações livres..."
                        className="min-h-[60px]"
                      />
                    </div>
                  )}

                </CardContent>
              </Card>
            ))}

            {/* Decision Section */}
            {/* Nota média — uso interno do recrutador, NÃO conta no score do candidato */}
            <Card className="border-dashed border-amber-300 bg-amber-50/40 dark:bg-amber-950/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Nota média da entrevista</span>
                  <span className={`text-2xl font-bold ${averageColor}`}>
                    {recruiterAverage == null ? "—" : `${recruiterAverage}`}
                    {recruiterAverage != null && <span className="text-sm text-muted-foreground font-normal">/100</span>}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Cálculo automático a partir das respostas (alto = 100, médio = 60, baixo = 20).
                  Referência <strong>interna do recrutador</strong> — não é contabilizada no score do candidato.
                </p>
                {recruiterAverage != null && (
                  <p className={`text-xs font-medium ${averageColor}`}>Faixa: {averageLabel}</p>
                )}

                {criteriaBreakdown.length > 0 && (
                  <div className="pt-2 border-t border-amber-200/60">
                    <p className="text-xs font-semibold text-foreground mb-2">% por critério</p>
                    <div className="space-y-1.5">
                      {criteriaBreakdown.map((item) => {
                        const color =
                          item.level === "alto" ? "text-green-600"
                          : item.level === "medio" ? "text-yellow-600"
                          : item.level === "baixo" ? "text-red-600"
                          : "text-muted-foreground";
                        return (
                          <div key={item.criterionId} className="flex items-center justify-between text-xs gap-2">
                            <span className="text-muted-foreground truncate">
                              <span className="text-foreground">{item.label}</span>
                              <span className="ml-1">· {item.blockName}</span>
                            </span>
                            <span className={`font-medium tabular-nums ${color}`}>
                              {item.percent == null ? "—" : `${item.percent}%`}
                              {item.total > 0 && (
                                <span className="ml-1 text-muted-foreground font-normal">
                                  ({item.answered}/{item.total})
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Decisão</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {readOnly ? (
                  <div className="space-y-2">
                    <Badge variant="outline" className="text-base px-3 py-1">
                      {DECISIONS.find(d => d.value === existingFeedback?.decision)?.label || existingFeedback?.decision}
                    </Badge>
                    {existingFeedback?.notes && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Notas</Label>
                        <p className="text-sm">{existingFeedback.notes}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <RadioGroup value={decision} onValueChange={setDecision} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {DECISIONS.map((d) => {
                        // Label dinâmico para "presencial" (próxima etapa) quando a unidade
                        // tem teste pós-entrevista configurado.
                        let label = d.label;
                        let Icon = d.icon;
                        if (d.value === "presencial" && unitTestCfg?.enabled) {
                          Icon = FlaskConical;
                          label =
                            unitTestCfg.modality === "online"
                              ? "Liberar teste online"
                              : unitTestCfg.modality === "presencial"
                                ? "Agendar teste presencial"
                                : "Liberar teste (online ou presencial)";
                        }
                        return (
                          <div key={d.value} className="flex items-center gap-2 p-3 border rounded-lg">
                            <RadioGroupItem value={d.value} id={`decision-${d.value}`} />
                            <Label htmlFor={`decision-${d.value}`} className={`flex items-center gap-1 cursor-pointer ${d.color}`}>
                              <Icon className="h-4 w-4" />
                              {label}
                            </Label>
                          </div>
                        );
                      })}
                    </RadioGroup>


                    {/* Coherence warning inline */}
                    {hasCriticalCriteria && isAdvancingDecision && (
                      <Alert variant="destructive">
                        <ShieldAlert className="h-4 w-4" />
                        <AlertTitle>Atenção: critérios críticos detectados</AlertTitle>
                        <AlertDescription>
                          Você marcou critérios como &quot;Crítico&quot; mas selecionou &quot;Próxima Etapa&quot;. Revise sua avaliação ou confirme ao finalizar.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Evasive pattern warning */}
                    {hasEvasivePattern && (
                      <Alert className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <AlertTitle className="text-yellow-700">Padrão evasivo detectado</AlertTitle>
                        <AlertDescription className="text-yellow-600">
                          {notAnsweredCount >= 2 && `${notAnsweredCount} perguntas não respondidas. `}
                          {partialAnswerCount >= 3 && `${partialAnswerCount} respostas parciais. `}
                          Considere investigar mais ou registrar nas observações.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* High risk score warning */}
                    {hasHighRisk && !hasCriticalCriteria && (
                      <Alert className="border-orange-400 bg-orange-50 dark:bg-orange-950/20">
                        <ShieldAlert className="h-4 w-4 text-orange-600" />
                        <AlertTitle className="text-orange-700">Risco elevado (score: {riskScore})</AlertTitle>
                        <AlertDescription className="text-orange-600">
                          A combinação de critérios de atenção e respostas incompletas indica risco. Revise antes de prosseguir.
                        </AlertDescription>
                      </Alert>
                    )}

                    <div>
                      <Label>Notas gerais</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Observações finais..."
                      />
                    </div>

                    <Button
                      className="w-full"
                      onClick={handleFinalizeClick}
                      disabled={!decision || submitFeedback.isPending}
                    >
                      {submitFeedback.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                      Finalizar Entrevista
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Coherence confirmation dialog */}
        <AlertDialog open={showCoherenceAlert} onOpenChange={setShowCoherenceAlert}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                Incoerência detectada
              </AlertDialogTitle>
              <AlertDialogDescription>
                Existem critérios marcados como <strong>&quot;Crítico&quot;</strong> nesta avaliação, mas a decisão escolhida é <strong>&quot;Próxima Etapa&quot;</strong>. 
                Deseja confirmar mesmo assim?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Revisar avaliação</AlertDialogCancel>
              <AlertDialogAction onClick={handleFinalize}>
                Confirmar e finalizar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Test release confirmation dialog */}
        <AlertDialog open={showTestReleaseConfirm} onOpenChange={setShowTestReleaseConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-primary" />
                Aprovar candidato e liberar teste?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Ao finalizar, o candidato será <strong>aprovado automaticamente na entrevista</strong> e avançará para a etapa de{" "}
                <strong>
                  {unitTestCfg?.modality === "online"
                    ? "teste online"
                    : unitTestCfg?.modality === "presencial"
                      ? "teste presencial"
                      : "teste (online ou presencial, à escolha do candidato)"}
                </strong>
                .
                {unitTestCfg?.modality !== "online" && (
                  <> O candidato poderá escolher data e horário disponíveis da unidade para realizar o teste.</>
                )}
                {unitTestCfg?.modality === "online" && (
                  <> O candidato poderá realizar o teste imediatamente.</>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setShowTestReleaseConfirm(false); handleFinalize(); }}>
                Confirmar e liberar teste
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
