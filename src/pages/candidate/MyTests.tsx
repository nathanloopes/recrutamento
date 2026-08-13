import { ClipboardList, Clock, CheckCircle2, PlayCircle, AlertCircle, ChevronRight, Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHelp } from "@/components/ui/page-help";
import { useMyTestAssignments, useMyPendingPipelineTests, TestAssignment } from "@/hooks/useTests";
import { useMyCompletedCargoTests } from "@/hooks/useCargoTest";
import { Link } from "react-router-dom";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatDateBR, ymdToLocalDate } from "@/lib/dateUtils";

// Status válidos vindos do banco (test_assignments.status):
// - pendente: aguardando início (setado na atribuição)
// - em_andamento: candidato começou a responder
// - enviado: resposta enviada (legacy)
// - avaliado: revisado por humano (legacy)
// - corrigido: auto-correção concluída (setado em useSubmitTestResponse)
// - pendente_revisao: IA falhou ou score=0, aguarda revisão humana (setado em useSubmitTestResponse)
// REGRA: todo novo status DEVE ser adicionado aqui E no filtro `completed` abaixo.
const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
  pendente: { label: "Pendente", variant: "outline", icon: Clock },
  em_andamento: { label: "Em andamento", variant: "default", icon: PlayCircle },
  enviado: { label: "Enviado", variant: "secondary", icon: CheckCircle2 },
  avaliado: { label: "Avaliado", variant: "secondary", icon: CheckCircle2 },
  corrigido: { label: "Corrigido", variant: "secondary", icon: CheckCircle2 },
  pendente_revisao: { label: "Em revisão", variant: "outline", icon: AlertCircle },
};

type UnifiedItem = (TestAssignment & { job_title?: string; source?: undefined })
  | { id: string; source: "cargo_test"; status: string; score: number | null; completed_at: string | null; deadline: null; job_title: string; test_templates: { title: string } }
  | { id: string; source: "pipeline_test"; applicationId: string; status: string; score: null; completed_at: null; deadline: null; job_title: string; test_templates: { title: string } };

function TestCard({ assignment }: { assignment: UnifiedItem }) {
  const source = (assignment as any).source;
  const isCargo = source === "cargo_test";
  const isPipeline = source === "pipeline_test";
  const template = (assignment as any).test_templates;
  const cfg = STATUS_CONFIG[assignment.status] || STATUS_CONFIG.pendente;
  const StatusIcon = cfg.icon;
  const deadline = (assignment as any).deadline;
  const deadlineLocal = deadline ? (ymdToLocalDate(deadline) ?? new Date(deadline)) : null;
  const isOverdue = !isCargo && !isPipeline && deadlineLocal && isPast(deadlineLocal) && assignment.status === "pendente";
  const canAct = isPipeline || (!isCargo && (assignment.status === "pendente" || assignment.status === "em_andamento"));

  const content = (
    <Card className="border-0 shadow-sm hover:shadow-md transition-all hover:scale-[1.01] active:scale-[0.99]">
      <CardContent className="flex items-center gap-4 p-4">
        <div className={`flex items-center justify-center w-11 h-11 rounded-xl shrink-0 ${
          isOverdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
        }`}>
          <ClipboardList className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {template?.title || "Teste"}
          </p>
          {(assignment as any).job_title && (
            <p className="text-xs text-muted-foreground truncate">
              {isCargo ? "Cargo" : "Vaga"}: {(assignment as any).job_title}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {isCargo && (
              <Badge variant="outline" className="text-[10px] gap-1 border-primary/40 text-primary">
                <Briefcase className="h-3 w-3" />
                Teste do Cargo
              </Badge>
            )}
            {isPipeline && (
              <Badge variant="outline" className="text-[10px] gap-1 border-primary/40 text-primary">
                <ClipboardList className="h-3 w-3" />
                Teste pós-entrevista
              </Badge>
            )}
            <Badge variant={isOverdue ? "destructive" : cfg.variant} className="text-[10px] gap-1">
              <StatusIcon className="h-3 w-3" />
              {isOverdue ? "Atrasado" : cfg.label}
            </Badge>
            {deadline && (
              <span className="text-[10px] text-muted-foreground">
                Prazo: {formatDateBR(deadline)}
              </span>
            )}
            {assignment.score !== null && assignment.score !== undefined && (
              <span className="text-[10px] font-medium text-primary">
                Nota: {Number(assignment.score).toFixed(0)}
              </span>
            )}
          </div>
        </div>
        {canAct && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </CardContent>
    </Card>
  );

  if (isCargo) return content;
  if (isPipeline) return <Link to={`/triagem/${(assignment as any).applicationId}`}>{content}</Link>;
  return <Link to={`/testes/${assignment.id}`}>{content}</Link>;
}

export default function MyTests() {
  const { data: assignments, isLoading } = useMyTestAssignments();
  const { data: cargoTests, isLoading: isLoadingCargo } = useMyCompletedCargoTests();
  const { data: pipelineTests, isLoading: isLoadingPipeline } = useMyPendingPipelineTests();

  const pendingAssignments = (assignments?.filter(a => a.status === "pendente") || []) as UnifiedItem[];
  const pending: UnifiedItem[] = [...((pipelineTests || []) as UnifiedItem[]), ...pendingAssignments];
  const inProgress = (assignments?.filter(a => a.status === "em_andamento") || []) as UnifiedItem[];
  const completedAssignments = (assignments?.filter(a =>
    ["enviado", "avaliado", "corrigido", "pendente_revisao"].includes(a.status)
  ) || []) as UnifiedItem[];
  const completed: UnifiedItem[] = [...completedAssignments, ...((cargoTests || []) as UnifiedItem[])];

  const sections = [
    { title: "Pendentes", items: pending },
    { title: "Em andamento", items: inProgress },
    { title: "Concluídos", items: completed },
  ];

  const loading = isLoading || isLoadingCargo || isLoadingPipeline;
  const hasAny = (assignments?.length || 0) + (cargoTests?.length || 0) + (pipelineTests?.length || 0) > 0;

  return (
    <div className="px-4 pt-6 space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">Meus Testes</h1>
          <p className="text-sm text-muted-foreground mt-1">Acompanhe seus testes e avaliações</p>
        </div>
        <PageHelp />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : !hasAny ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-muted">
              <ClipboardList className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">Nenhum teste no momento</p>
            <p className="text-xs text-muted-foreground">Quando um recrutador atribuir um teste à sua candidatura, ele aparecerá aqui.</p>
          </CardContent>
        </Card>
      ) : (
        sections.map(section => (
          section.items.length > 0 && (
            <div key={section.title} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title} ({section.items.length})
              </p>
              {section.items.map(a => <TestCard key={a.id} assignment={a} />)}
            </div>
          )
        ))
      )}
    </div>
  );
}
