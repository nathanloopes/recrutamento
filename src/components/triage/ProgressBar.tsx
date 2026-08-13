import { Progress } from "@/components/ui/progress";

interface ProgressBarProps {
  currentPhaseIndex: number;
  totalPhases: number;
  currentStepIndex: number;
  totalSteps: number;
  phaseName: string;
}

export function TriageProgressBar({
  currentPhaseIndex,
  totalPhases,
  currentStepIndex,
  totalSteps,
  phaseName,
}: ProgressBarProps) {
  const stepProgress = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{phaseName}</span>
        <span className="text-muted-foreground">
          Fase {currentPhaseIndex + 1}/{totalPhases} · Etapa {currentStepIndex + 1}/{totalSteps}
        </span>
      </div>
      <Progress value={stepProgress} className="h-2" />
      <div className="flex gap-1">
        {Array.from({ length: totalPhases }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < currentPhaseIndex
                ? "bg-primary"
                : i === currentPhaseIndex
                ? "bg-primary/50"
                : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
