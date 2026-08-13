import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, CheckCircle2, XCircle, Clock } from "lucide-react";

interface Phase {
  id: string;
  name: string;
  min_score: number;
  phase_type?: string;
  pipeline_steps: { id: string; title: string; weight: number; type: string }[];
}

interface Props {
  phases: Phase[];
}

export function ScoreSimulator({ phases }: Props) {
  const [stepScores, setStepScores] = useState<Record<string, number>>({});
  const [showResult, setShowResult] = useState(false);

  const setScore = (stepId: string, value: number) => {
    setStepScores((prev) => ({ ...prev, [stepId]: value }));
  };

  const results = useMemo(() => {
    if (!phases || phases.length === 0) return null;

    const phaseResults = phases.map((phase) => {
      const steps = phase.pipeline_steps || [];
      const totalWeight = steps.reduce((sum, s) => sum + (s.weight || 1), 0);
      if (totalWeight === 0) return { phase, score: 0, passes: true };

      const weightedSum = steps.reduce((sum, s) => {
        const score = stepScores[s.id] ?? 70;
        return sum + score * (s.weight || 1);
      }, 0);

      const phaseScore = Math.floor(weightedSum / totalWeight);
      const passes = phaseScore >= (phase.min_score || 0);
      return { phase, score: phaseScore, passes };
    });

    const totalWeightAll = phases.reduce((sum, ph) => sum + (ph.pipeline_steps || []).reduce((s, st) => s + (st.weight || 1), 0), 0);
    const totalScoreAll = phases.reduce((sum, ph) => {
      return sum + (ph.pipeline_steps || []).reduce((s, st) => {
        const score = stepScores[st.id] ?? 70;
        return s + score * (st.weight || 1);
      }, 0);
    }, 0);

    const finalScore = totalWeightAll > 0 ? Math.floor(totalScoreAll / totalWeightAll) : 0;
    const allPass = phaseResults.every((r) => r.passes || r.phase.phase_type === "classificatoria");

    return { phaseResults, finalScore, allPass };
  }, [phases, stepScores]);

  if (!phases || phases.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Selecione um pipeline ativo para usar o simulador.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          Simulador de Aprovação por Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {phases.map((phase) => (
          <div key={phase.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-semibold">{phase.name}</Label>
              <Badge variant="secondary" className="text-[10px]">Mín: {phase.min_score}</Badge>
              <Badge variant="outline" className="text-[10px]">
                {phase.phase_type === "classificatoria" ? "Classificatória" : "Eliminatória"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {(phase.pipeline_steps || []).map((step) => (
                <div key={step.id} className="space-y-1">
                  <Label className="text-xs truncate block">{step.title}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={stepScores[step.id] ?? 70}
                    onChange={(e) => setScore(step.id, Number(e.target.value))}
                    className="h-8"
                  />
                  <p className="text-[10px] text-muted-foreground">Peso: {step.weight} · {step.type}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        <Button onClick={() => setShowResult(true)} className="w-full sm:w-auto">
          <Calculator className="h-4 w-4 mr-1" /> Simular
        </Button>

        {showResult && results && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Score Final Ponderado</p>
              <span className="text-2xl font-bold">{results.finalScore}</span>
            </div>

            <div className="space-y-2">
              {results.phaseResults.map((r) => (
                <div key={r.phase.id} className="flex items-center justify-between text-sm">
                  <span>{r.phase.name} ({r.score}) ≥ {r.phase.min_score}</span>
                  {r.passes ? (
                    <Badge className="bg-emerald-100 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Aprovado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">
                      <Clock className="h-3 w-3 mr-1" /> Standby
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            <div className={`rounded-lg p-3 text-center ${
              results.allPass ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"
            }`}>
              <p className="text-base font-bold flex items-center justify-center gap-2">
                {results.allPass ? (
                  <><CheckCircle2 className="h-5 w-5" /> APROVADO</>
                ) : (
                  <><Clock className="h-5 w-5" /> ABAIXO DO MÍNIMO</>
                )}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
