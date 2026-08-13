import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

type ColumnKey = "triagem" | "entrevista" | "aprovado" | "contratado" | "standby";

interface KanbanCandidate {
  id: string;
  candidate_id: string;
  status: string;
  total_score: number | null;
  full_name: string;
  email: string;
  current_phase_name: string | null;
  column: ColumnKey;
}

const KANBAN_COLUMNS: { key: ColumnKey; label: string; color: string }[] = [
  { key: "triagem", label: "Triagem", color: "bg-blue-500" },
  { key: "aprovado", label: "Aprovado", color: "bg-success" },
  { key: "entrevista", label: "Entrevista", color: "bg-purple-500" },
  { key: "contratado", label: "Contratado", color: "bg-primary" },
  { key: "standby", label: "Standby", color: "bg-warning" },
];

const COLUMN_KEYS = new Set<ColumnKey>(KANBAN_COLUMNS.map((c) => c.key));

const TRIAGEM_STATUSES = new Set(["pendente", "em_andamento", "apto_para_vaga", "em_avaliacao"]);
const STANDBY_STATUSES = new Set(["standby", "reprovado"]);
const TERMINAL_OUT_OF_BOARD = new Set(["desistente", "desligado", "pausado", "declinado"]);
const ACTIVE_INTERVIEW_STATUSES = new Set([
  "scheduled",
  "rescheduled",
  "reschedule_requested",
  "completed",
]);

function deriveColumn(status: string, hasActiveInterview: boolean): ColumnKey | null {
  if (TERMINAL_OUT_OF_BOARD.has(status)) return null;
  if (status === "contratado") return "contratado";
  if (STANDBY_STATUSES.has(status)) return "standby";
  if (hasActiveInterview && status !== "contratado" && !STANDBY_STATUSES.has(status)) {
    return "entrevista";
  }
  if (status === "aprovado") return "aprovado";
  if (TRIAGEM_STATUSES.has(status)) return "triagem";
  return "triagem";
}

function DroppableColumn({ columnKey, children }: { columnKey: ColumnKey; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey });
  return (
    <div
      ref={setNodeRef}
      className={`space-y-1.5 min-h-[60px] rounded-lg p-1.5 transition-colors ${
        isOver ? "bg-primary/10 ring-2 ring-primary/30" : "bg-muted/30"
      }`}
    >
      {children}
    </div>
  );
}

function DraggableCard({ candidate, disabled }: { candidate: KanbanCandidate; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: candidate.id,
    disabled,
    data: { column: candidate.column },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
      <CandidateCard candidate={candidate} isDragging={isDragging} />
    </div>
  );
}

function CandidateCard({ candidate: c, isDragging }: { candidate: KanbanCandidate; isDragging?: boolean }) {
  return (
    <Card className={`shadow-sm ${isDragging ? "opacity-50 ring-2 ring-primary" : ""} cursor-grab active:cursor-grabbing`}>
      <CardContent className="p-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-[9px]">{c.full_name.charAt(0)}</AvatarFallback>
          </Avatar>
          <span className="text-xs font-medium text-foreground truncate name-display">{c.full_name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.total_score != null ? (
            <Badge variant="outline" className="text-[9px]">Score: {c.total_score}</Badge>
          ) : (
            <Badge variant="outline" className="text-[9px] text-muted-foreground">Score: —</Badge>
          )}
          {c.current_phase_name && (
            <Badge variant="secondary" className="text-[9px]">{c.current_phase_name}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function CorporateKanban({ unitJobId, kanbanEnabled = true }: { unitJobId: string; kanbanEnabled?: boolean }) {
  const [candidates, setCandidates] = useState<KanbanCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCandidate, setActiveCandidate] = useState<KanbanCandidate | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const fetchCandidates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("applications")
      .select("id, candidate_id, status, total_score, current_phase, profiles:candidate_id(full_name, email), pipeline_phases:current_phase(name)")
      .eq("unit_job_id", unitJobId);

    if (!error && data) {
      const appIds = (data as any[]).map((a) => a.id);
      const interviewMap = new Map<string, boolean>();
      if (appIds.length > 0) {
        const { data: interviews } = await supabase
          .from("interviews")
          .select("application_id, status")
          .in("application_id", appIds);
        (interviews || []).forEach((iv: any) => {
          if (ACTIVE_INTERVIEW_STATUSES.has(iv.status)) {
            interviewMap.set(iv.application_id, true);
          }
        });
      }

      const mapped: KanbanCandidate[] = [];
      (data as any[]).forEach((a) => {
        const hasInterview = interviewMap.get(a.id) === true;
        const col = deriveColumn(a.status, hasInterview);
        if (!col) return;
        mapped.push({
          id: a.id,
          candidate_id: a.candidate_id,
          status: a.status,
          total_score: a.total_score,
          full_name: a.profiles?.full_name || "Candidato",
          email: a.profiles?.email || "",
          current_phase_name: a.pipeline_phases?.name || null,
          column: col,
        });
      });
      setCandidates(mapped);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCandidates();

    const channel = supabase
      .channel(`kanban_${unitJobId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications", filter: `unit_job_id=eq.${unitJobId}` },
        () => { fetchCandidates(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interviews" },
        () => { fetchCandidates(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitJobId]);

  const handleDragStart = (event: DragStartEvent) => {
    const c = candidates.find((c) => c.id === event.active.id);
    setActiveCandidate(c || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveCandidate(null);
    const { active, over } = event;
    if (!over) return;

    const candidateId = active.id as string;
    let targetColumn = over.id as ColumnKey;

    // If dropped on a card, resolve the card's column
    if (!COLUMN_KEYS.has(targetColumn)) {
      const targetCandidate = candidates.find((c) => c.id === targetColumn);
      if (targetCandidate) {
        targetColumn = targetCandidate.column;
      } else if (over.data?.current?.column) {
        targetColumn = over.data.current.column as ColumnKey;
      } else {
        return;
      }
    }

    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate || candidate.column === targetColumn) return;

    // Entrevista é coluna derivada — só entra agendando entrevista pelo painel.
    if (targetColumn === "entrevista") {
      toast.info("Para mover para Entrevista, agende uma entrevista pelo painel do candidato.");
      return;
    }

    const targetStatus =
      targetColumn === "triagem" ? "em_andamento" : (targetColumn as string);

    // Optimistic update
    setCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, status: targetStatus, column: targetColumn } : c))
    );

    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: targetStatus as any })
        .eq("id", candidateId);
      if (error) throw error;
      toast.success(`${candidate.full_name} movido para ${KANBAN_COLUMNS.find((c) => c.key === targetColumn)?.label || targetColumn}`);
    } catch (e: any) {
      setCandidates((prev) =>
        prev.map((c) => (c.id === candidateId ? candidate : c))
      );
      toast.error("Erro ao mover candidato: " + e.message);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {KANBAN_COLUMNS.map((col) => (
          <div key={col.key} className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const grouped: Record<ColumnKey, KanbanCandidate[]> = {
    triagem: [],
    entrevista: [],
    aprovado: [],
    contratado: [],
    standby: [],
  };
  candidates.forEach((c) => {
    grouped[c.column].push(c);
  });

  const isDragEnabled = kanbanEnabled;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {KANBAN_COLUMNS.map((col) => (
          <div key={col.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${col.color}`} />
              <span className="text-xs font-semibold text-foreground">{col.label}</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{grouped[col.key].length}</Badge>
            </div>
            <DroppableColumn columnKey={col.key}>
              {grouped[col.key].length === 0 && (
                <p className="text-[10px] text-muted-foreground text-center py-3">Nenhum</p>
              )}
              {grouped[col.key].map((c) => (
                <DraggableCard key={c.id} candidate={c} disabled={!isDragEnabled} />
              ))}
            </DroppableColumn>
          </div>
        ))}
      </div>
      <DragOverlay>
        {activeCandidate ? <CandidateCard candidate={activeCandidate} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
