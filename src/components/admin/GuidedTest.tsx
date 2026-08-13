import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, ShieldAlert, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveTestGuide, useTestFeedback, useSubmitTestFeedback } from "@/hooks/useTestFeedback";

interface GuidedTestProps {
  booking: any; // test_bookings row joined with application/candidate
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}

const SCALE = [
  { value: "alto", label: "Alto", color: "text-green-600" },
  { value: "medio", label: "Médio", color: "text-yellow-600" },
  { value: "baixo", label: "Baixo", color: "text-red-600" },
];

const DECISIONS = [
  { value: "aprovado", label: "Aprovar", icon: CheckCircle2, color: "text-green-600" },
  { value: "reprovado", label: "Reprovado", icon: XCircle, color: "text-red-600" },
  { value: "standby", label: "Standby", icon: AlertTriangle, color: "text-yellow-600" },
  { value: "declinado", label: "Declinou a vaga", icon: XCircle, color: "text-red-600" },
  { value: "encerrado", label: "Processo Encerrado", icon: XCircle, color: "text-red-600" },
];

const SCALE_TO_SCORE: Record<string, number> = { alto: 100, medio: 60, baixo: 20 };

function getQuestionText(question: any): string {
  return String(question?.text || question?.label || "").trim();
}

function getQuestionCriterionId(block: any, question: any): string | null {
  return question?.criterion_id || block?.criteria?.[0]?.id || null;
}

export function GuidedTest({ booking, open, onOpenChange, readOnly = false }: GuidedTestProps) {
  const { user } = useAuth();
  const applicationId: string | undefined = booking?.application_id;
  const bookingId: string | undefined = booking?.id;
  const jobId: string | undefined =
    booking?.applications?.unit_jobs?.jobs?.id || booking?.job_id;
  const unitId: string | undefined =
    booking?.unit_id || booking?.applications?.unit_jobs?.unit_id;
  const candidateName: string =
    booking?.candidate_name ||
    booking?.applications?.candidates?.full_name ||
    "Candidato";
  const jobTitle: string =
    booking?.applications?.unit_jobs?.jobs?.title || "—";

  const { data: guide, isLoading: guideLoading } = useActiveTestGuide(jobId);
  const { data: existingFeedback } = useTestFeedback({ applicationId, bookingId });
  const submitFeedback = useSubmitTestFeedback();

  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [criteriaAnswers, setCriteriaAnswers] = useState<Record<string, string>>({});
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<string>("");
  const [standbyReason, setStandbyReason] = useState("");
  const [notes, setNotes] = useState("");
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);

  const draftKey = bookingId
    ? `guided_test_draft:${bookingId}`
    : applicationId
      ? `guided_test_draft:app:${applicationId}`
      : null;
  const draftLoadedRef = useRef(false);

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
        if (d.standbyReason) setStandbyReason(d.standbyReason);
        if (d.notes) setNotes(d.notes);
        if (d.savedAt) setAutoSavedAt(new Date(d.savedAt));
      }
    } catch (e) {
      console.error("[GuidedTest] draft load error", e);
    }
    draftLoadedRef.current = true;
  }, [open, readOnly, draftKey]);

  useEffect(() => {
    if (!open || readOnly || !draftKey || !draftLoadedRef.current) return;
    const hasAny =
      Object.keys(questionAnswers).length > 0 ||
      Object.keys(criteriaAnswers).length > 0 ||
      Object.keys(observations).length > 0 ||
      decision || standbyReason || notes;
    if (!hasAny) return;
    const t = setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(
          draftKey,
          JSON.stringify({ questionAnswers, criteriaAnswers, observations, decision, standbyReason, notes, savedAt }),
        );
        setAutoSavedAt(new Date(savedAt));
      } catch (e) {
        console.error("[GuidedTest] draft save error", e);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [open, readOnly, draftKey, questionAnswers, criteriaAnswers, observations, decision, standbyReason, notes]);

  const blocks: any[] = readOnly
    ? existingFeedback?.test_guides?.guide_json?.blocks || existingFeedback?.checklist_json?.blocks || []
    : guide?.guide_json?.blocks || [];

  const feedbackData = existingFeedback?.checklist_json || {};

  // Populate fields in read-only mode from saved feedback
  useEffect(() => {
    if (!readOnly || !existingFeedback) return;
    setQuestionAnswers(feedbackData?.questions || {});
    setCriteriaAnswers(feedbackData?.criteria || {});
    setObservations(feedbackData?.observations || {});
    setDecision(existingFeedback?.decision || "");
    setStandbyReason(existingFeedback?.standby_reason || "");
    setNotes(existingFeedback?.notes || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, existingFeedback?.id]);

  const scoreToLevel = (score: number): "alto" | "medio" | "baixo" =>
    score >= 75 ? "alto" : score >= 45 ? "medio" : "baixo";

  // Breakdown por critério
  const criteriaBreakdown = useMemo(() => {
    const source = readOnly ? (feedbackData?.questions || {}) : questionAnswers;
    const result: { blockName: string; criterionId: string; label: string; percent: number | null; level: string | null; answered: number; total: number }[] = [];
    for (const block of blocks) {
      for (const c of (block.criteria || [])) {
        const linked = (block.questions || []).filter((q: any) =>
          getQuestionText(q) && getQuestionCriterionId(block, q) === c.id
        );
        const scores = linked
          .map((q: any) => SCALE_TO_SCORE[(source as any)[q.id]])
          .filter((n: any) => typeof n === "number");
        const percent = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;
        result.push({
          blockName: block.title || block.name || "",
          criterionId: c.id,
          label: c.text || c.label || "—",
          percent,
          level: percent == null ? null : scoreToLevel(percent),
          answered: scores.length,
          total: linked.length,
        });
      }
      if ((!block.criteria || block.criteria.length === 0) && (block.questions || []).some((q: any) => getQuestionText(q))) {
        const linked = (block.questions || []).filter((q: any) => getQuestionText(q));
        const scores = linked
          .map((q: any) => SCALE_TO_SCORE[(source as any)[q.id]])
          .filter((n: any) => typeof n === "number");
        const percent = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;
        result.push({
          blockName: block.title || block.name || "",
          criterionId: `block:${block.id || block.name || result.length}`,
          label: block.title || block.name || "Critério do bloco",
          percent,
          level: percent == null ? null : scoreToLevel(percent),
          answered: scores.length,
          total: linked.length,
        });
      }
    }
    return result;
  }, [blocks, readOnly, feedbackData, questionAnswers]);

  // Auto-deriva criteriaAnswers a partir das perguntas
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

  const evaluableQuestions = blocks.flatMap((b: any) => b.questions || []).filter((q: any) => getQuestionText(q));
  const totalItems = evaluableQuestions.length;
  const answeredItems = evaluableQuestions.filter((q: any) => questionAnswers[q.id]).length;
  const progress = totalItems > 0 ? Math.round((answeredItems / totalItems) * 100) : 0;

  const criticalCount = criteriaBreakdown.filter((c) => c.level === "baixo").length;
  const attentionCount = criteriaBreakdown.filter((c) => c.level === "medio").length;
  const notAnswered = Object.values(questionAnswers).filter((v) => v === "baixo").length;
  const partial = Object.values(questionAnswers).filter((v) => v === "medio").length;
  const riskScore = criticalCount * 3 + attentionCount * 1 + notAnswered * 2 + partial * 1;
  const hasHighRisk = riskScore >= 5;
  const hasEvasive = notAnswered >= 2 || partial >= 3;

  const recruiterAverage = useMemo(() => {
    const values = Object.values(questionAnswers)
      .map((v) => SCALE_TO_SCORE[v as string])
      .filter((n) => typeof n === "number");
    if (!values.length) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }, [questionAnswers]);

  const requiredQuestions = blocks.flatMap((b) => (b.questions || []).filter((q: any) => getQuestionText(q) && q.required));
  const allRequiredAnswered = requiredQuestions.every((q: any) => questionAnswers[q.id]);
  const allCriteriaAnswered = true; // derivado automaticamente

  const handleFinalize = async () => {
    if (!decision) return toast.error("Selecione uma decisão");
    if (!allRequiredAnswered) return toast.error("Responda todas as perguntas obrigatórias");
    if (!allCriteriaAnswered) return toast.error("Preencha todos os critérios");
    if (decision === "standby" && !standbyReason.trim())
      return toast.error("Informe o motivo do standby");
    if (!user?.id || !applicationId) return toast.error("Dados inválidos");

    try {
      await submitFeedback.mutateAsync({
        application_id: applicationId,
        booking_id: bookingId || null,
        test_guide_id: guide?.id || null,
        test_guide_version: guide?.version || null,
        evaluator_id: user.id,
        unit_id: unitId || null,
        checklist_json: {
          questions: questionAnswers,
          criteria: criteriaAnswers,
          observations,
          risk_analysis: {
            risk_score: riskScore,
            critical_count: criticalCount,
            attention_count: attentionCount,
            not_answered: notAnswered,
            partial,
          },
        },
        decision: decision as any,
        standby_reason: decision === "standby" ? standbyReason : null,
        notes: notes || null,
        risk_score: riskScore,
        recruiter_average: recruiterAverage,
      });
      if (draftKey) localStorage.removeItem(draftKey);
      toast.success("Avaliação registrada");
      onOpenChange(false);
    } catch (e: any) {
      console.error("[GuidedTest] submit error", e);
      toast.error(e?.message || "Falha ao registrar avaliação");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-amber-600" />
            Aplicação de Teste — {candidateName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{jobTitle}</p>
        </DialogHeader>

        {guideLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !blocks.length ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Nenhum roteiro ativo</AlertTitle>
            <AlertDescription>
              Esta vaga não possui um roteiro de teste ativo. Cadastre um em Configurações &gt; Roteiros de Teste.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Progresso: {answeredItems}/{totalItems}
              </span>
              {autoSavedAt && !readOnly && (
                <span className="text-muted-foreground">
                  Rascunho salvo {autoSavedAt.toLocaleTimeString("pt-BR")}
                </span>
              )}
            </div>
            <Progress value={progress} />

            {(hasHighRisk || hasEvasive) && !readOnly && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Sinais de atenção detectados</AlertTitle>
                <AlertDescription>
                  Risco: {riskScore} · Críticos: {criticalCount} · Não respondidas: {notAnswered}
                </AlertDescription>
              </Alert>
            )}

            {blocks.map((block: any, bi: number) => (
              <Card key={block.id || bi}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    {block.name ||
                      block.title ||
                      (block.criteria || [])
                        .map((c: any) => c.label || c.text)
                        .filter(Boolean)
                        .join(" · ") ||
                      "Critérios"}
                    {block.type && <Badge variant="outline" className="text-[10px]">{block.type}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(block.questions || []).filter((q: any) => getQuestionText(q)).map((q: any) => (
                    <div key={q.id} className="space-y-2 rounded-md border border-border/60 p-3">
                      <div className="flex items-start gap-2">
                        <p className="text-sm flex-1">
                          {getQuestionText(q)}
                          {q.required && <span className="text-destructive ml-1">*</span>}
                        </p>
                      </div>
                      <Select
                        value={questionAnswers[q.id] || ""}
                        onValueChange={(v) =>
                          !readOnly && setQuestionAnswers((prev) => ({ ...prev, [q.id]: v }))
                        }
                        disabled={readOnly}
                      >
                        <SelectTrigger className="w-[180px] h-9">
                          <SelectValue placeholder="Selecionar nível" />
                        </SelectTrigger>
                        <SelectContent>
                          {SCALE.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              <span className={s.color}>{s.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  {readOnly && (block.criteria || []).map((c: any) => (
                    <div key={c.id} className="space-y-2">
                      <Label className="text-sm font-medium">{c.text || c.label}</Label>
                      <Badge variant="outline">
                        {SCALE.find((s) => s.value === criteriaAnswers[c.id])?.label || "—"}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}

            <div className="space-y-2">
              <Label>Observações gerais</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Decisão</Label>
              <RadioGroup
                value={decision}
                onValueChange={(v) => !readOnly && setDecision(v)}
                disabled={readOnly}
                className="flex flex-wrap gap-3"
              >
                {DECISIONS.map((d) => (
                  <div key={d.value} className="flex items-center gap-1.5">
                    <RadioGroupItem value={d.value} id={`d-${d.value}`} />
                    <Label htmlFor={`d-${d.value}`} className={`text-sm flex items-center gap-1 ${d.color}`}>
                      <d.icon className="h-4 w-4" /> {d.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {decision === "standby" && (
              <div className="space-y-2">
                <Label>Motivo do standby (visível ao candidato) *</Label>
                <Textarea
                  value={standbyReason}
                  onChange={(e) => setStandbyReason(e.target.value)}
                  disabled={readOnly}
                  rows={2}
                />
              </div>
            )}

            {recruiterAverage !== null && (
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Nota média do teste</span>
                  <span className="text-lg font-bold text-amber-700">{recruiterAverage}%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Risco: {riskScore}</p>
                {criteriaBreakdown.length > 0 && (
                  <div className="pt-2 border-t border-amber-200/60">
                    <p className="text-xs font-semibold mb-1.5">% por critério</p>
                    <div className="space-y-1">
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
                              {item.blockName && <span className="ml-1">· {item.blockName}</span>}
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
              </div>
            )}

            {!readOnly && (
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleFinalize}
                  disabled={submitFeedback.isPending}
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                >
                  {submitFeedback.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Finalizar avaliação
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
