import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle, MessageSquare, Brain, Info, MinusCircle } from "lucide-react";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  applicationId: string;
  candidateName?: string | null;
}

interface NormalizedTest {
  id: string;
  title: string;
  score: number | null;
  status?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  evaluator_notes?: string | null;
  questions: any[]; // definição das perguntas (options/statements/correct)
  breakdown: any[]; // resposta+score por pergunta
  aiGrading?: any[];
}

/* ---------------- helpers ---------------- */

function scoreTone(s: number | null | undefined) {
  if (s == null) return { text: "text-muted-foreground", bar: "" };
  if (s >= 70) return { text: "text-green-600 dark:text-green-400", bar: "[&>div]:bg-green-500" };
  if (s >= 40) return { text: "text-yellow-600 dark:text-yellow-400", bar: "[&>div]:bg-yellow-500" };
  return { text: "text-red-600 dark:text-red-400", bar: "[&>div]:bg-red-500" };
}

function borderByScore(s: number | null | undefined) {
  if (s == null) return "border-border";
  if (s >= 70) return "border-green-500 bg-green-50/40 dark:bg-green-950/20";
  if (s >= 40) return "border-yellow-500 bg-yellow-50/40 dark:bg-yellow-950/20";
  return "border-red-500 bg-red-50/40 dark:bg-red-950/20";
}

function optText(opt: any) {
  return typeof opt === "string" ? opt : opt?.text || opt?.label || opt?.title || "";
}

/* ---------------- render por tipo ---------------- */

function QuestionCard({ q, b, idx, aiGrading }: { q: any; b: any; idx: number; aiGrading?: any }) {
  const prompt: string = q?.prompt || q?.question || q?.text || b?.prompt || `Pergunta ${idx + 1}`;
  const type: string = (q?.type || b?.type || "").toString().toLowerCase();
  const response = b?.response || {};
  const score: number | null = b?.score != null ? Number(b.score) : null;

  const border = borderByScore(score);

  // Header comum
  const HeaderIcon = () => {
    if (score == null) return <MinusCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />;
    if (score >= 70) return <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />;
    if (score >= 40) return <MinusCircle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />;
    return <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />;
  };

  return (
    <div className={`text-xs rounded-md border-2 p-3 space-y-2 ${border}`}>
      <div className="flex items-start gap-2">
        <HeaderIcon />
        <div className="flex-1">
          <p className="text-foreground font-medium whitespace-pre-line">
            {idx + 1}. {prompt}
          </p>
          {q?.weight != null && (
            <span className="text-[10px] text-muted-foreground">Peso: {q.weight}</span>
          )}
        </div>
        {score != null && (
          <Badge variant="outline" className={`text-[10px] ${scoreTone(score).text}`}>
            {Math.round(score)}%
          </Badge>
        )}
      </div>

      {/* ---- IMAGEM ---- */}
      {type === "imagem" && (
        <div className="ml-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(q.options || []).map((opt: any, oi: number) => {
            const isSel = oi === Number(response.selected_index);
            const isRight = opt?.correct === true;
            const cls = isRight
              ? "border-green-500 ring-2 ring-green-500/40"
              : isSel
              ? "border-red-500 ring-2 ring-red-500/40"
              : "border-border";
            return (
              <div key={oi} className={`rounded border-2 p-1 space-y-1 ${cls}`}>
                <img
                  src={opt.image_url || opt.url}
                  alt={`Opção ${oi + 1}`}
                  className="w-full h-24 object-contain bg-muted rounded"
                />
                <div className="flex items-center justify-between text-[9px]">
                  <span className="font-mono opacity-70">{String.fromCharCode(65 + oi)}</span>
                  {isSel && <Badge variant="outline" className="text-[9px] h-4">marcada</Badge>}
                  {isRight && (
                    <Badge variant="outline" className="text-[9px] h-4 border-green-500 text-green-700 dark:text-green-400">
                      correta
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- TRUE/FALSE ---- */}
      {type === "true_false" && (
        <div className="ml-6 space-y-1">
          {(response.breakdown || []).map((row: any, ri: number) => {
            const rowClr = row.correct
              ? "border-green-500 bg-green-100/60 dark:bg-green-950/40 text-green-800 dark:text-green-300"
              : "border-red-500 bg-red-100/60 dark:bg-red-950/40 text-red-800 dark:text-red-300";
            return (
              <div key={ri} className={`flex items-center gap-2 rounded border px-2 py-1 ${rowClr}`}>
                <span className="flex-1">{row.text}</span>
                <Badge variant="outline" className="text-[9px] h-4">
                  Marcou: {row.chosen ? "V" : "F"}
                </Badge>
                <Badge variant="outline" className="text-[9px] h-4">
                  Correto: {row.expected ? "V" : "F"}
                </Badge>
              </div>
            );
          })}
          {response.correct_count != null && (
            <p className="text-[10px] text-muted-foreground">
              {response.correct_count} de {response.total} afirmações corretas
            </p>
          )}
        </div>
      )}

      {/* ---- QUIZ (peso alto/medio/baixo, sem "correct" absoluto) ---- */}
      {type === "quiz" && (
        <div className="ml-6 space-y-1">
          {(q.options || []).map((opt: any, oi: number) => {
            const isSel = oi === Number(response.selected_index);
            const w = String(opt?.weight || "").toLowerCase();
            const tone =
              w === "alto"
                ? "text-green-700 dark:text-green-400"
                : w === "medio" || w === "médio"
                ? "text-yellow-700 dark:text-yellow-400"
                : w === "baixo"
                ? "text-red-700 dark:text-red-400"
                : "text-muted-foreground";
            const rowBorder = isSel
              ? w === "alto"
                ? "border-green-500 bg-green-100/60 dark:bg-green-950/40"
                : w === "medio" || w === "médio"
                ? "border-yellow-500 bg-yellow-100/60 dark:bg-yellow-950/40"
                : w === "baixo"
                ? "border-red-500 bg-red-100/60 dark:bg-red-950/40"
                : "border-border"
              : "border-border bg-background";
            return (
              <div key={oi} className={`flex items-center gap-2 rounded border px-2 py-1 ${rowBorder}`}>
                <span className="text-[10px] font-mono opacity-70">{String.fromCharCode(65 + oi)}.</span>
                <span className="flex-1">{optText(opt)}</span>
                <Badge variant="outline" className={`text-[9px] h-4 ${tone}`}>
                  peso: {opt?.weight || "—"}
                </Badge>
                {isSel && (
                  <Badge variant="outline" className="text-[9px] h-4">
                    marcada
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---- MÚLTIPLA ESCOLHA / OBJETIVA (correct por opção) ---- */}
      {(type === "multipla_escolha" || type === "multiple_choice" || type === "objetiva") && (
        <div className="ml-6 space-y-1">
          {(q.options || []).map((opt: any, oi: number) => {
            const isSel = oi === Number(response.selected_index);
            const isRight =
              typeof q.correct === "number"
                ? oi === q.correct
                : opt?.correct === true;
            const rowClr = isRight
              ? "border-green-500 bg-green-100/60 dark:bg-green-950/40 text-green-800 dark:text-green-300"
              : isSel
              ? "border-red-500 bg-red-100/60 dark:bg-red-950/40 text-red-800 dark:text-red-300"
              : "border-border bg-background";
            return (
              <div key={oi} className={`flex items-center gap-2 rounded border px-2 py-1 ${rowClr}`}>
                <span className="text-[10px] font-mono opacity-70">{String.fromCharCode(65 + oi)}.</span>
                <span className="flex-1">{optText(opt)}</span>
                {isSel && (
                  <Badge variant="outline" className="text-[9px] h-4">
                    marcada
                  </Badge>
                )}
                {isRight && (
                  <Badge variant="outline" className="text-[9px] h-4 border-green-500 text-green-700 dark:text-green-400">
                    correta
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---- DESCRITIVA / DISSERTATIVA ---- */}
      {(type === "dissertativa" || type === "descritiva" || type === "essay" || type === "texto") && (
        <div className="ml-6 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
            <p className="text-foreground/80 italic">
              {response.text || response.answer || response.value || "— sem resposta —"}
            </p>
          </div>
          {aiGrading && !aiGrading.error && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Brain className="h-3 w-3 text-primary shrink-0" />
                <Badge variant="outline" className={`text-[10px] ${scoreTone(aiGrading.score).text}`}>
                  {aiGrading.score}/100
                </Badge>
              </div>
              {aiGrading.justification && (
                <p className="text-[10px] text-muted-foreground">{aiGrading.justification}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- NUMÉRICO ---- */}
      {(type === "numerico" || type === "number") && (
        <div className="ml-6">
          <p className="text-foreground">
            Resposta: <span className="font-semibold">{response.value ?? response.answer ?? "—"}</span>
            {q.correct != null && (
              <span className="text-muted-foreground ml-2">(esperado: {q.correct})</span>
            )}
          </p>
        </div>
      )}

      {/* ---- FALLBACK ---- */}
      {![
        "imagem",
        "true_false",
        "quiz",
        "multipla_escolha",
        "multiple_choice",
        "objetiva",
        "dissertativa",
        "descritiva",
        "essay",
        "texto",
        "numerico",
        "number",
      ].includes(type) && (
        <div className="ml-6 text-[11px] text-muted-foreground">
          <p>Tipo: {type || "—"}</p>
          <pre className="text-[10px] bg-muted rounded p-2 overflow-x-auto">
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}

      {!type && (
        <div className="ml-6 flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400">
          <Info className="h-3 w-3 shrink-0" />
          Sem tipo declarado — exibindo dados brutos da resposta.
        </div>
      )}
    </div>
  );
}

/* ---------------- fetch + normalização ---------------- */

async function fetchAnswerKey(applicationId: string): Promise<NormalizedTest[]> {
  // 1) test_assignments (fluxo antigo)
  const { data: assigns } = await (supabase as any)
    .from("test_assignments")
    .select(
      "id, status, score, started_at, completed_at, response, evaluator_notes, test_templates(id, title, content)",
    )
    .eq("application_id", applicationId)
    .eq("post_interview", true)
    .order("created_at", { ascending: false });

  const fromAssigns: NormalizedTest[] = ((assigns || []) as any[]).map((a) => {
    const questions = (a.test_templates?.content?.questions || []) as any[];
    const answers = (a.response?.answers || {}) as Record<string, any>;
    const breakdown = questions.map((q, i) => ({
      prompt: q?.question || q?.text,
      type: q?.type || (Array.isArray(q?.options) ? "multipla_escolha" : "dissertativa"),
      score: null,
      response:
        typeof answers[i] === "object"
          ? answers[i]
          : { selected_index: Number(answers[i]), text: answers[i] },
    }));
    return {
      id: a.id,
      title: a.test_templates?.title || "Teste",
      score: a.score,
      status: a.status,
      started_at: a.started_at,
      completed_at: a.completed_at,
      evaluator_notes: a.evaluator_notes,
      questions,
      breakdown,
      aiGrading: a.response?.ai_grading,
    };
  });

  // 2) step_responses (fluxo wizard do pipeline)
  const { data: steps } = await (supabase as any)
    .from("step_responses")
    .select(
      "id, application_id, score, response, evaluated_at, created_at, " +
        "pipeline_steps!inner(id, title, type, weight, content, phase_id, pipeline_phases!inner(phase_kind))",
    )
    .eq("application_id", applicationId)
    .eq("pipeline_steps.pipeline_phases.phase_kind", "avaliacao_pos_entrevista")
    .order("created_at", { ascending: false });

  const fromSteps: NormalizedTest[] = ((steps || []) as any[]).map((sr) => {
    const ps = sr.pipeline_steps || {};
    const questions = (ps.content?.questions || []) as any[];
    const rawBreakdown = (sr.response?.breakdown || []) as any[];
    // Mapear breakdown por question_id para casar com questions
    const bdMap: Record<string, any> = {};
    rawBreakdown.forEach((b: any) => {
      if (b?.question_id) bdMap[b.question_id] = b;
    });
    const breakdown = questions.map((q, i) => {
      const b = bdMap[q?.id] || rawBreakdown[i] || {};
      return {
        prompt: b.prompt || q?.prompt || q?.question,
        type: b.type || q?.type,
        score: b.score,
        weight: b.weight ?? q?.weight,
        response: b.response || {},
      };
    });
    return {
      id: sr.id,
      title: ps.title || "Teste pós-entrevista",
      score: sr.score,
      status: null,
      started_at: null,
      completed_at: sr.evaluated_at || sr.created_at,
      evaluator_notes: null,
      questions,
      breakdown,
    };
  });

  return [...fromAssigns, ...fromSteps];
}

/* ---------------- componente principal ---------------- */

export function OnlineTestAnswerKeyDialog({ open, onOpenChange, applicationId, candidateName }: Props) {
  const { data: tests, isLoading } = useQuery({
    queryKey: ["online_test_answer_key", applicationId],
    enabled: !!open && !!applicationId,
    queryFn: () => fetchAnswerKey(applicationId),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gabarito do teste online</DialogTitle>
          <DialogDescription>
            {candidateName ? `Candidato: ${candidateName}` : "Detalhes das respostas"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !tests || tests.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum teste online encontrado para este candidato.
          </p>
        ) : (
          <div className="space-y-4">
            {tests.map((t) => {
              const tone = scoreTone(t.score);
              return (
                <div key={t.id} className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{t.title}</span>
                    {t.status && <Badge variant="outline">{t.status}</Badge>}
                  </div>

                  {t.score != null && (
                    <div className="flex items-center gap-3">
                      <span className={`text-2xl font-bold ${tone.text}`}>{Math.round(Number(t.score))}</span>
                      <div className="flex-1 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground">Nota / 100</span>
                        <Progress value={Math.min(100, Number(t.score))} className={`h-2 ${tone.bar}`} />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4 text-[11px] text-muted-foreground">
                    {t.started_at && <span>Início: {format(new Date(t.started_at), "dd/MM/yyyy HH:mm")}</span>}
                    {t.completed_at && (
                      <span>Conclusão: {format(new Date(t.completed_at), "dd/MM/yyyy HH:mm")}</span>
                    )}
                  </div>

                  {!t.questions || t.questions.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      Este teste não expõe as perguntas em formato de gabarito.
                    </p>
                  ) : (
                    <div className="space-y-2 pt-2 border-t">
                      <span className="text-[11px] font-medium text-muted-foreground">Respostas detalhadas</span>
                      {t.questions.map((q, idx) => {
                        const b = t.breakdown[idx] || {};
                        const aig = t.aiGrading?.find((g: any) => g.questionIndex === idx);
                        return <QuestionCard key={q?.id || idx} q={q} b={b} idx={idx} aiGrading={aig} />;
                      })}
                    </div>
                  )}

                  {t.evaluator_notes && (
                    <div className="text-xs text-muted-foreground border-t pt-2">
                      <span className="font-medium">Obs. avaliador:</span> {t.evaluator_notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
