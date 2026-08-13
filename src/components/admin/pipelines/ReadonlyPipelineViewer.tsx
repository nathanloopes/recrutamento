import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Eye, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Step {
  id: string;
  title: string;
  type: string;
  weight: number;
  is_optional?: boolean;
  is_automated?: boolean;
  order_index: number;
}

interface Phase {
  id: string;
  name: string;
  min_score: number;
  phase_type?: string;
  is_active?: boolean;
  order_index: number;
  pipeline_steps: Step[];
}

interface Pipeline {
  id: string;
  name: string;
  is_active: boolean;
  version?: number;
  pipeline_phases: Phase[];
}

interface Props {
  pipelines: Pipeline[];
}

const STEP_TYPE_LABELS: Record<string, string> = {
  texto: "Texto",
  quiz: "Quiz",
  true_false: "Verdadeiro / Falso",
  video: "Vídeo",
  audio: "Áudio",
  imagem: "Imagem",
  entrevista_voz: "Entrevista por Voz",
};

export function ReadonlyPipelineViewer({ pipelines }: Props) {
  const activePipeline = pipelines.find((p) => p.is_active) || pipelines[0];

  // Fetch candidate counts per phase
  const phaseIds = activePipeline?.pipeline_phases.map((p) => p.id) || [];
  const { data: phaseCounts } = useQuery({
    queryKey: ["pipeline-phase-counts", phaseIds],
    enabled: phaseIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("applications")
        .select("current_phase")
        .in("current_phase", phaseIds)
        .eq("status", "em_andamento" as any);
      const counts: Record<string, number> = {};
      (data || []).forEach((app: any) => {
        counts[app.current_phase] = (counts[app.current_phase] || 0) + 1;
      });
      return counts;
    },
  });

  if (!activePipeline) {
    return (
      <p className="text-sm text-muted-foreground italic">Nenhum pipeline definido para este cargo.</p>
    );
  }

  const totalWeight = (steps: Step[]) => steps.reduce((sum, s) => sum + (s.weight || 0), 0);

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Pipeline: {activePipeline.name}
          <Badge variant="secondary" className="text-[10px]">
            {activePipeline.is_active ? "Ativo" : "Inativo"}
          </Badge>
          {activePipeline.version && (
            <Badge variant="outline" className="text-[10px]">v{activePipeline.version}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activePipeline.pipeline_phases.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem fases definidas.</p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {activePipeline.pipeline_phases.map((phase, idx) => {
              const candidateCount = phaseCounts?.[phase.id] || 0;
              return (
                <AccordionItem key={phase.id} value={phase.id}>
                  <AccordionTrigger className="hover:no-underline py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[9px]">{idx + 1}</Badge>
                      <span className="font-medium">{phase.name}</span>
                      <Badge variant={phase.phase_type === "classificatoria" ? "outline" : "secondary"} className="text-[9px]">
                        {phase.phase_type === "classificatoria" ? "Classificatória" : "Eliminatória"}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px]">Score mín: {phase.min_score}</Badge>
                      <Badge variant="outline" className="text-[9px]">{phase.pipeline_steps.length} etapa(s)</Badge>
                      <Badge variant="outline" className="text-[9px]">Peso: {totalWeight(phase.pipeline_steps)}</Badge>
                      {candidateCount > 0 && (
                        <Badge variant="default" className="text-[9px] flex items-center gap-0.5">
                          <Users className="h-3 w-3" />
                          {candidateCount}
                        </Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pl-4 space-y-1">
                    {phase.pipeline_steps.map((step, stIdx) => (
                      <div key={step.id} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/30 border">
                        <Badge variant="outline" className="text-[8px]">{stIdx + 1}</Badge>
                        <Badge variant="secondary" className="text-[8px]">{STEP_TYPE_LABELS[step.type] || step.type}</Badge>
                        <span className="flex-1 truncate">{step.title}</span>
                        {step.is_optional && <Badge variant="outline" className="text-[8px] text-amber-600">Opcional</Badge>}
                        {step.is_automated === false && <Badge variant="outline" className="text-[8px] text-blue-600">Manual</Badge>}
                        <span className="text-muted-foreground">Peso: {step.weight}</span>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
