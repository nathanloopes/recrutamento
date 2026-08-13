import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";

interface Statement {
  id: string;
  text: string;
  correct: boolean;
}

interface Props {
  title: string;
  prompt?: string;
  statements: Statement[];
  onSubmit: (response: any, score: number) => void;
  isSubmitting: boolean;
}

/**
 * Renderer para o tipo `true_false` com múltiplas afirmativas sob um único enunciado.
 * Para cada afirmativa o candidato escolhe Verdadeiro ou Falso.
 * Score = (acertos / total) * 100 — segue a mesma escala 0..100 dos demais tipos,
 * portanto entra no pipeline-score-engine sem regra nova.
 */
export function TrueFalseMultiStep({ title, prompt, statements, onSubmit, isSubmitting }: Props) {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const total = statements.length;
  const answered = statements.filter((s) => typeof answers[s.id] === "boolean").length;
  const allAnswered = answered === total;

  const handleConfirm = () => {
    let correctCount = 0;
    const breakdown = statements.map((s) => {
      const chosen = answers[s.id];
      const isCorrect = chosen === s.correct;
      if (isCorrect) correctCount++;
      return {
        id: s.id,
        text: s.text,
        expected: s.correct,
        chosen,
        correct: isCorrect,
      };
    });
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    onSubmit({ true_false: true, breakdown, correct_count: correctCount, total }, score);
  };

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        {prompt && <p className="text-sm text-foreground whitespace-pre-line">{prompt}</p>}
        <p className="text-xs text-muted-foreground">
          Marque <strong>V</strong> (verdadeiro) ou <strong>F</strong> (falso) para cada afirmativa abaixo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {statements.map((s, i) => {
          const chosen = answers[s.id];
          return (
            <div
              key={s.id}
              className="flex items-start gap-3 p-3 rounded-lg border bg-card"
            >
              <span className="text-xs font-semibold text-muted-foreground pt-1 w-5 shrink-0">{i + 1}.</span>
              <p className="flex-1 text-sm whitespace-pre-line">{s.text}</p>
              <div className="flex gap-1 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant={chosen === true ? "default" : "outline"}
                  className="h-8 px-3 text-xs"
                  onClick={() => setAnswers((a) => ({ ...a, [s.id]: true }))}
                  disabled={isSubmitting}
                >
                  {chosen === true && <Check className="h-3 w-3 mr-1" />}V
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={chosen === false ? "default" : "outline"}
                  className="h-8 px-3 text-xs"
                  onClick={() => setAnswers((a) => ({ ...a, [s.id]: false }))}
                  disabled={isSubmitting}
                >
                  {chosen === false && <Check className="h-3 w-3 mr-1" />}F
                </Button>
              </div>
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {answered} de {total} respondidas
          </span>
          <Button onClick={handleConfirm} disabled={!allAnswered || isSubmitting}>
            {isSubmitting ? "Enviando..." : "Confirmar Respostas"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
