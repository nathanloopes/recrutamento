import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, ChevronUp, ChevronDown, Pencil, Copy, Power, PowerOff, GripVertical, Settings2 } from "lucide-react";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { useJobs } from "@/hooks/useJobs";
import {
  usePipelinesByJob,
  useCreatePipeline,
  useCreatePhase,
  useUpdatePhase,
  useDeletePhase,
  useCreateStep,
  useUpdateStep,
  useDeleteStep,
  useReorderPhase,
  useReorderStep,
  useTogglePipeline,
  useDeletePipeline,
  useDuplicatePipeline,
} from "@/hooks/usePipelines";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { toast } from "sonner";
import StepContentEditor from "@/components/admin/pipelines/StepContentEditor";
import { ScoreSimulator } from "@/components/admin/pipelines/ScoreSimulator";
import { PageHelp } from "@/components/ui/page-help";
import { useAuth } from "@/contexts/AuthContext";

const STEP_TYPES = [
  { value: "texto", label: "Texto" },
  { value: "quiz", label: "Quiz" },
  { value: "true_false", label: "Verdadeiro / Falso" },
  { value: "video", label: "Vídeo" },
  { value: "audio", label: "Áudio" },
  { value: "imagem", label: "Imagem" },
  { value: "entrevista_voz", label: "Entrevista por Voz" },
  { value: "misto", label: "Misto (tipo por pergunta)" },
] as const;

export default function Pipelines() {
  const { hasRole } = useAuth();
  const canManage = hasRole("admin");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [newPipelinePhaseKind, setNewPipelinePhaseKind] = useState("triagem");
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  // Draft inline (sem persistência) — abre formulário visual antes de criar qualquer registro
  const [draftPipelineOpen, setDraftPipelineOpen] = useState(false);
  const [draftPhaseKind, setDraftPhaseKind] = useState("triagem");
  const [newPhaseData, setNewPhaseData] = useState({ name: "", min_score: 60, pipelineId: "", phase_type: "eliminatoria" as string, phase_kind: "avaliacao" as string, is_active: true });
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [configPhaseId, setConfigPhaseId] = useState<string | null>(null);

  // Step dialog state (shared for create & edit)
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepData, setStepData] = useState({ title: "", type: "texto" as string, weight: 2, content: {} as any, phaseId: "", is_optional: false, is_automated: true, conditions: null as any });

  const WEIGHT_OPTIONS = [
    { value: 1, label: "1 — Baixo" },
    { value: 2, label: "2 — Médio" },
    { value: 3, label: "3 — Alto" },
  ];
  const normalizeWeight = (w: any): number => {
    const n = Number(w);
    if (!isFinite(n) || n <= 1) return 1;
    if (n >= 3) return 3;
    return 2;
  };
  const weightLabel = (w: any) => {
    const n = normalizeWeight(w);
    return n === 1 ? "Baixo" : n === 2 ? "Médio" : "Alto";
  };

  // Phase rename
  const [renamingPhaseId, setRenamingPhaseId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Double confirm for delete
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deletePhaseTarget, setDeletePhaseTarget] = useState<{ id: string; name: string; pipelineId: string } | null>(null);
  const [deleteStepTarget, setDeleteStepTarget] = useState<{ id: string; title: string } | null>(null);

  // Drag-and-drop state
  const [dragPhaseId, setDragPhaseId] = useState<string | null>(null);
  const [dragStepId, setDragStepId] = useState<string | null>(null);
  const [dragStepPhaseId, setDragStepPhaseId] = useState<string | null>(null);

  const { data: jobs } = useJobs();
  const { data: pipelineSettings } = useGlobalSettings("pipelines");
  const stepWeightLimit = Number(pipelineSettings?.find((s: any) => s.key === "step_weight_limit")?.value ?? 10);
  const { data: pipelines, isLoading } = usePipelinesByJob(selectedJobId);
  const createPipeline = useCreatePipeline();
  const createPhase = useCreatePhase();
  const updatePhase = useUpdatePhase();
  const deletePhase = useDeletePhase();
  const createStep = useCreateStep();
  const updateStep = useUpdateStep();
  const deleteStep = useDeleteStep();
  const reorderPhase = useReorderPhase();
  const reorderStep = useReorderStep();
  const togglePipeline = useTogglePipeline();
  const deletePipelineMut = useDeletePipeline();
  const duplicatePipeline = useDuplicatePipeline();

  const PHASE_KIND_LABELS: Record<string, string> = {
    triagem: "Triagem",
    avaliacao: "Teste pré-entrevista",
    entrevista: "Entrevista",
    avaliacao_pos_entrevista: "Teste pós-entrevista",
    documentacao: "Documentação",
    resultado: "Resultado",
  };

  // Materializa o draft: cria pipeline + primeira fase apenas quando o usuário realmente
  // for adicionar um bloco de perguntas. Retorna o id da fase criada (para abrir o editor de bloco).
  const materializeDraftPipeline = async (): Promise<string | null> => {
    if (!selectedJobId) return null;
    try {
      const job = jobs?.find((j) => j.id === selectedJobId);
      const baseName = `Pipeline - ${job?.title || "Cargo"}`;
      const existing = pipelines || [];
      let pipelineName = baseName;
      let suffix = 2;
      while (existing.some((p: any) => p.name === pipelineName)) {
        pipelineName = `${baseName} (${suffix++})`;
      }
      // Cria inativo primeiro (trigger BEFORE INSERT exige fase existente p/ ativar)
      const createdPipeline: any = await createPipeline.mutateAsync({ name: pipelineName, job_id: selectedJobId, is_active: false } as any);
      if (!createdPipeline?.id) throw new Error("Falha ao criar pipeline");
      const createdPhase: any = await createPhase.mutateAsync({
        pipeline_id: createdPipeline.id,
        name: PHASE_KIND_LABELS[draftPhaseKind] || "Triagem",
        min_score: 60,
        order_index: 0,
        phase_type: "eliminatoria",
        phase_kind: draftPhaseKind,
        is_active: true,
      } as any);
      // Agora ativa (já existe fase, trigger passa)
      await togglePipeline.mutateAsync({ id: createdPipeline.id, is_active: true, jobId: selectedJobId });
      toast.success("Pipeline criado");
      setDraftPipelineOpen(false);
      setDraftPhaseKind("triagem");
      return createdPhase?.id || null;
    } catch (e: any) {
      toast.error(e.message);
      return null;
    }
  };

  // Handler do botão "Adicionar bloco de perguntas" no draft inline
  const handleDraftAddBlock = async () => {
    const phaseId = await materializeDraftPipeline();
    if (phaseId) openCreateStep(phaseId);
  };

  const handleCreatePhase = async () => {
    if (!newPhaseData.name.trim()) return;
    const clampedScore = Math.round(Math.min(100, Math.max(0, newPhaseData.min_score)));
    try {
      const phases = pipelines?.find((p: any) => p.id === newPhaseData.pipelineId)?.pipeline_phases || [];
      const created: any = await createPhase.mutateAsync({
        pipeline_id: newPhaseData.pipelineId,
        name: newPhaseData.name,
        min_score: clampedScore,
        order_index: phases.length,
        phase_type: newPhaseData.phase_type,
        phase_kind: newPhaseData.phase_kind,
        is_active: newPhaseData.is_active,
      } as any);
      toast.success("Fase criada");
      setPhaseDialogOpen(false);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleSaveStep = async () => {
    // Título não é mais pedido na UI — fixado como o nome da fase vinculada (na criação) ou mantido (na edição).
    try {
      if (editingStepId) {
        await updateStep.mutateAsync({
          id: editingStepId,
          title: stepData.title,
          type: stepData.type as any,
          weight: stepData.weight,
          content: stepData.content,
          is_optional: stepData.is_optional,
          is_automated: stepData.is_automated,
          conditions: stepData.conditions,
        } as any);
        toast.success("Etapa atualizada");
      } else {
        if (!stepData.phaseId) {
          toast.error("Fase não encontrada. Reabra o pipeline e tente novamente.");
          return;
        }
        // Validação anti-FK: confirmar que a fase realmente existe no banco antes do insert
        const { data: phaseCheck, error: phaseCheckError } = await supabase
          .from("pipeline_phases")
          .select("id")
          .eq("id", stepData.phaseId)
          .maybeSingle();
        if (phaseCheckError || !phaseCheck) {
          toast.error("A fase deste bloco não existe mais. Reabra o pipeline e tente novamente.");
          setStepDialogOpen(false);
          setStepData({ title: "", type: "texto", weight: 2, content: {}, phaseId: "", is_optional: false, is_automated: true, conditions: null });
          return;
        }
        const pipeline = pipelines?.find((p: any) => p.pipeline_phases.some((ph: any) => ph.id === stepData.phaseId));
        const phase = pipeline?.pipeline_phases.find((ph: any) => ph.id === stepData.phaseId);
        const steps = phase?.pipeline_steps || [];
        const fixedTitle = (phase?.name || "Bloco").trim();
        await createStep.mutateAsync({
          phase_id: stepData.phaseId,
          title: fixedTitle,
          type: stepData.type as any,
          weight: stepData.weight,
          content: stepData.content,
          order_index: steps.length,
          is_optional: stepData.is_optional,
          is_automated: stepData.is_automated,
          conditions: stepData.conditions,
        } as any);
        toast.success("Etapa criada");
      }
      setStepDialogOpen(false);
      setEditingStepId(null);
      setStepData({ title: "", type: "texto", weight: 2, content: {}, phaseId: "", is_optional: false, is_automated: true, conditions: null });
    } catch (e: any) { toast.error(e.message); }
  };

  const openEditStep = (step: any) => {
    setEditingStepId(step.id);
    setStepData({
      title: step.title,
      type: step.type,
      weight: normalizeWeight(step.weight),
      content: step.content || {},
      phaseId: step.phase_id,
      is_optional: step.is_optional || false,
      is_automated: step.is_automated !== false,
      conditions: step.conditions || null,
    });
    setStepDialogOpen(true);
  };

  const openCreateStep = (phaseId: string) => {
    setEditingStepId(null);
    setStepData({ title: "", type: "texto", weight: 2, content: {}, phaseId, is_optional: false, is_automated: true, conditions: null });
    setStepDialogOpen(true);
  };

  const handleRenamePhase = async (phaseId: string) => {
    if (!renameValue.trim()) return;
    try {
      await updatePhase.mutateAsync({ id: phaseId, name: renameValue });
      toast.success("Fase renomeada");
      setRenamingPhaseId(null);
    } catch (e: any) { toast.error(e.message); }
  };

  const totalWeight = (steps: any[]) => steps.reduce((sum: number, s: any) => sum + (s.weight || 0), 0);

  // ── Drag-and-drop handlers ──
  const handlePhaseDragStart = (e: React.DragEvent, phaseId: string) => {
    setDragPhaseId(phaseId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handlePhaseDrop = (e: React.DragEvent, targetPhaseId: string, phases: any[]) => {
    e.preventDefault();
    if (!dragPhaseId || dragPhaseId === targetPhaseId) return;
    const fromIdx = phases.findIndex((p: any) => p.id === dragPhaseId);
    const toIdx = phases.findIndex((p: any) => p.id === targetPhaseId);
    if (fromIdx === -1 || toIdx === -1) return;
    // Batch reorder: update all order_index values
    const reordered = [...phases];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    reordered.forEach(async (ph, idx) => {
      if (ph.order_index !== idx) {
        await supabase.from("pipeline_phases").update({ order_index: idx } as any).eq("id", ph.id);
      }
    });
    setDragPhaseId(null);
    // Refresh
    setTimeout(() => reorderPhase.reset(), 100);
  };

  const handleStepDragStart = (e: React.DragEvent, stepId: string, phaseId: string) => {
    setDragStepId(stepId);
    setDragStepPhaseId(phaseId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleStepDrop = (e: React.DragEvent, targetStepId: string, steps: any[]) => {
    e.preventDefault();
    if (!dragStepId || dragStepId === targetStepId) return;
    const fromIdx = steps.findIndex((s: any) => s.id === dragStepId);
    const toIdx = steps.findIndex((s: any) => s.id === targetStepId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...steps];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    reordered.forEach(async (st, idx) => {
      if (st.order_index !== idx) {
        await supabase.from("pipeline_steps").update({ order_index: idx } as any).eq("id", st.id);
      }
    });
    setDragStepId(null);
    setDragStepPhaseId(null);
    setTimeout(() => reorderStep.reset(), 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Pipelines e Etapas</h2>
        <PageHelp />
      </div>

      {/* Job selector */}
      <Select value={selectedJobId || ""} onValueChange={setSelectedJobId}>
        <SelectTrigger className="w-full md:w-80">
          <SelectValue placeholder="Selecione um cargo" />
        </SelectTrigger>
        <SelectContent>
          {jobs?.map((j) => (
            <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedJobId && (
        <>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <strong>Regra do fluxo:</strong> cada cargo tem <strong>um único pipeline ativo</strong>, e todo pipeline ativo precisa ter pelo menos uma fase. Pipelines inativos ficam como rascunho e só substituem o ativo quando você ativá-los manualmente.
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">Pipelines</h3>
            {canManage && (pipelines?.length ?? 0) === 0 && (
              <Button
                size="sm"
                onClick={() => { setDraftPhaseKind("triagem"); setDraftPipelineOpen(true); }}
                disabled={createPipeline.isPending || createPhase.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                Novo Pipeline
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
          ) : pipelines?.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum pipeline para este cargo.</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {pipelines?.map((pipeline: any) => {
                const activePhasesCount = (pipeline.pipeline_phases || []).filter((ph: any) => ph.is_active !== false).length;
                const currentlyActive = (pipelines || []).find((p: any) => p.is_active && p.id !== pipeline.id);
                const cannotActivate = !pipeline.is_active && activePhasesCount === 0;
                return (
                <Card key={pipeline.id} id={`pipeline-${pipeline.id}`}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2 min-w-0">
                      <span className="truncate">{pipeline.name}</span>
                      <Badge variant={pipeline.is_active ? "default" : "secondary"} className="shrink-0">
                        {pipeline.is_active ? "Ativo" : "Rascunho"}
                      </Badge>
                    </CardTitle>
                    {canManage && (
                    <div className="flex items-center gap-1 shrink-0 flex-wrap">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={cannotActivate || togglePipeline.isPending}
                        title={
                          cannotActivate
                            ? "Adicione ao menos uma fase antes de ativar"
                            : pipeline.is_active
                              ? "Desativar pipeline"
                              : currentlyActive
                                ? `Ativar (substituirá "${currentlyActive.name}")`
                                : "Ativar pipeline"
                        }
                        onClick={() => {
                          if (!pipeline.is_active && currentlyActive) {
                            const ok = window.confirm(
                              `Isso desativará o pipeline "${currentlyActive.name}", que está em uso para este cargo.\n\nDeseja continuar?`
                            );
                            if (!ok) return;
                          }
                          togglePipeline.mutate(
                            { id: pipeline.id, is_active: !pipeline.is_active, jobId: selectedJobId! },
                            { onError: (e: any) => toast.error(e.message) }
                          );
                        }}
                      >
                        {pipeline.is_active ? <Power className="h-3.5 w-3.5 text-success" /> : <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Duplicar pipeline"
                        onClick={() => {
                          duplicatePipeline.mutate({ pipelineId: pipeline.id, jobId: selectedJobId! });
                          toast.success("Pipeline duplicado");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Excluir pipeline"
                        onClick={() => setDeleteTarget({ id: pipeline.id, name: pipeline.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNewPhaseData({ name: PHASE_KIND_LABELS.avaliacao, min_score: 60, pipelineId: pipeline.id, phase_type: "eliminatoria", phase_kind: "avaliacao", is_active: true });
                          setPhaseDialogOpen(true);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />Fase
                      </Button>
                    </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    {pipeline.pipeline_phases.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma fase ainda.</p>
                    ) : (
                      <Accordion type="multiple" className="w-full">
                        {pipeline.pipeline_phases.map((phase: any, phIdx: number) => (
                          <AccordionItem
                            key={phase.id}
                            value={phase.id}
                            draggable
                            onDragStart={(e) => handlePhaseDragStart(e, phase.id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => handlePhaseDrop(e, phase.id, pipeline.pipeline_phases)}
                            className={dragPhaseId === phase.id ? "opacity-50" : ""}
                          >
                            <AccordionTrigger className="hover:no-underline gap-2 py-3">
                              <div className="flex flex-wrap items-center gap-2 text-sm flex-1 min-w-0">
                                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                                </div>
                                <Badge variant="outline" className="text-[10px]">{phIdx + 1}</Badge>
                                <span className="font-medium truncate max-w-[160px] sm:max-w-none">{phase.name}</span>
                                {canManage && (
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <Button variant="ghost" size="icon" className="h-5 w-5" title="Editar configurações" onClick={() => setConfigPhaseId(phase.id)}>
                                    <Settings2 className="h-3 w-3" />
                                  </Button>
                                </div>
                                )}
                                <Badge variant={phase.phase_type === "classificatoria" ? "outline" : "secondary"} className="text-[10px]">
                                  {phase.phase_type === "classificatoria" ? "Classificatória" : "Eliminatória"}
                                </Badge>
                                {phase.is_active === false && <Badge variant="destructive" className="text-[10px]">Inativa</Badge>}
                                <Badge variant="secondary" className="text-[10px]">Score mín: {phase.min_score}</Badge>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-3 pl-2 sm:pl-4">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded border bg-muted/20">
                                <div className="space-y-1">
                                  <Label className="text-xs">Tipo da Fase</Label>
                                  <Select
                                    value={phase.phase_type}
                                    onValueChange={(v) => updatePhase.mutate({ id: phase.id, phase_type: v as any })}
                                  >
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="eliminatoria">Eliminatória</SelectItem>
                                      <SelectItem value="classificatoria">Classificatória</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Categoria da Fase</Label>
                                  <Select
                                    value={(phase as any).phase_kind || "avaliacao"}
                                    onValueChange={(v) => updatePhase.mutate({ id: phase.id, phase_kind: v as any })}
                                  >
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="triagem">Triagem (antes da escolha de unidade)</SelectItem>
                                      <SelectItem value="avaliacao">Teste pré-entrevista (após escolha de unidade)</SelectItem>
                                      <SelectItem value="entrevista">Entrevista</SelectItem>
                                      <SelectItem value="avaliacao_pos_entrevista">Teste pós-entrevista</SelectItem>
                                      <SelectItem value="documentacao">Documentação</SelectItem>
                                      <SelectItem value="resultado">Resultado</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Score mínimo (0–100)</Label>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      className="w-20 h-8 text-xs"
                                      min={0}
                                      max={100}
                                      value={phase.min_score}
                                      onChange={(e) => {
                                        const val = Math.round(Math.min(100, Math.max(0, Number(e.target.value))));
                                        updatePhase.mutate({ id: phase.id, min_score: val });
                                      }}
                                    />
                                    {canManage && (
                                    <Button variant="ghost" size="icon" className="h-8 w-8 ml-auto" onClick={() => setDeletePhaseTarget({ id: phase.id, name: phase.name, pipelineId: pipeline.id })}>
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {phase.pipeline_steps.map((step: any, stIdx: number) => (
                                <div
                                  key={step.id}
                                  className={`flex flex-wrap items-center gap-2 p-2 rounded border border-border bg-card text-sm ${dragStepId === step.id ? "opacity-50" : ""}`}
                                  draggable
                                  onDragStart={(e) => { e.stopPropagation(); handleStepDragStart(e, step.id, phase.id); }}
                                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  onDrop={(e) => { e.stopPropagation(); handleStepDrop(e, step.id, phase.pipeline_steps); }}
                                >
                                  {/* Step reorder */}
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab" />
                                    <Button
                                      variant="ghost" size="icon" className="h-5 w-5"
                                      disabled={stIdx === 0}
                                      onClick={() => reorderStep.mutate({ steps: phase.pipeline_steps, stepId: step.id, direction: "up" })}
                                    >
                                      <ChevronUp className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost" size="icon" className="h-5 w-5"
                                      disabled={stIdx === phase.pipeline_steps.length - 1}
                                      onClick={() => reorderStep.mutate({ steps: phase.pipeline_steps, stepId: step.id, direction: "down" })}
                                    >
                                      <ChevronDown className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <Badge variant="outline" className="text-[9px] shrink-0">{stIdx + 1}</Badge>

                                  {/* Inline title (autosave on blur) */}
                                  <Input
                                    defaultValue={step.title}
                                    key={`${step.id}-${step.title}`}
                                    className="h-7 text-xs flex-1 min-w-[140px]"
                                    onBlur={(e) => {
                                      const v = e.target.value.trim();
                                      if (v && v !== step.title) {
                                        updateStep.mutate({ id: step.id, title: v } as any);
                                      }
                                    }}
                                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  />

                                  {/* Inline type (autosave) */}
                                  <Select
                                    value={step.type}
                                    onValueChange={(v) => updateStep.mutate({ id: step.id, type: v as any } as any)}
                                  >
                                    <SelectTrigger className="h-7 w-[110px] text-xs shrink-0"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {STEP_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                    </SelectContent>
                                  </Select>

                                  {/* Inline weight (oculto em quiz — peso por alternativa) */}
                                  {step.type !== "quiz" && (
                                    <Select
                                      value={String(normalizeWeight(step.weight))}
                                      onValueChange={(v) => updateStep.mutate({ id: step.id, weight: Number(v) } as any)}
                                    >
                                      <SelectTrigger className="h-7 w-[100px] text-xs shrink-0"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        {WEIGHT_OPTIONS.map((opt) => (
                                          <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}

                                  {step.is_optional && <Badge variant="outline" className="text-[9px] text-amber-600 shrink-0">Opcional</Badge>}
                                  {step.is_automated === false && <Badge variant="outline" className="text-[9px] text-blue-600 shrink-0">Manual</Badge>}

                                  {canManage && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Editar perguntas e regras" onClick={() => openEditStep(step)}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  )}
                                  {canManage && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Excluir etapa" onClick={() => setDeleteStepTarget({ id: step.id, title: step.title })}>
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                  )}
                                </div>
                              ))}

                              {phase.pipeline_steps.length === 0 && (
                                <p className="text-xs text-muted-foreground text-center py-2">
                                  Esta fase ainda não tem blocos de perguntas. Adicione um bloco para começar.
                                </p>
                              )}

                              {canManage && phase.pipeline_steps.length === 0 && (
                              <Button variant="outline" size="sm" className="text-xs" onClick={() => openCreateStep(phase.id)}>
                                <Plus className="h-3 w-3 mr-1" />Adicionar bloco de perguntas
                              </Button>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    )}
                  </CardContent>
                </Card>
              );})}
            </div>
          )}
        </>
      )}

      {/* Novo Pipeline — Dialog no mesmo padrão visual do módulo Testes (apenas UI; lógica intacta) */}
      <Dialog open={draftPipelineOpen} onOpenChange={(o) => { if (!o) setDraftPhaseKind("triagem"); setDraftPipelineOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fase do Pipeline</Label>
              <Select value={draftPhaseKind} onValueChange={setDraftPhaseKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="triagem">Triagem (liberada antes da escolha de unidade)</SelectItem>
                  <SelectItem value="avaliacao">Teste pré-entrevista (após escolha de unidade)</SelectItem>
                  <SelectItem value="entrevista">Entrevista</SelectItem>
                  <SelectItem value="avaliacao_pos_entrevista">Teste pós-entrevista (após a entrevista)</SelectItem>
                  <SelectItem value="documentacao">Documentação</SelectItem>
                  <SelectItem value="resultado">Resultado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Blocos de Perguntas</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDraftAddBlock}
                  disabled={createPipeline.isPending || createPhase.isPending}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {createPipeline.isPending || createPhase.isPending ? "Criando..." : "Adicionar bloco de perguntas"}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="flex !justify-between">
            <span />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setDraftPipelineOpen(false); setDraftPhaseKind("triagem"); }}>Cancelar</Button>
              <Button
                onClick={async () => { await materializeDraftPipeline(); }}
                disabled={createPipeline.isPending || createPhase.isPending}
              >
                {createPipeline.isPending || createPhase.isPending ? "Criando..." : "Criar"}
              </Button>
            </div>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* Phase Dialog — criação rápida (apenas Nome + Categoria). Demais ajustes na edição. */}
      <Dialog open={phaseDialogOpen} onOpenChange={setPhaseDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova Fase</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fase do Pipeline</Label>
              <Select value={newPhaseData.phase_kind} onValueChange={(v) => setNewPhaseData({ ...newPhaseData, name: PHASE_KIND_LABELS[v] || "Avaliação", phase_kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="triagem">Triagem (liberada antes da escolha de unidade)</SelectItem>
                  <SelectItem value="avaliacao">Teste pré-entrevista (após escolha de unidade)</SelectItem>
                  <SelectItem value="entrevista">Entrevista</SelectItem>
                  <SelectItem value="avaliacao_pos_entrevista">Teste pós-entrevista (após a entrevista)</SelectItem>
                  <SelectItem value="documentacao">Documentação</SelectItem>
                  <SelectItem value="resultado">Resultado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhaseDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreatePhase} disabled={!newPhaseData.phase_kind || createPhase.isPending}>
              {createPhase.isPending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase Config Sheet — painel lateral com TODAS as configurações avançadas (autosave) */}
      <Sheet open={!!configPhaseId} onOpenChange={(open) => { if (!open) setConfigPhaseId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {(() => {
            const phase = pipelines
              ?.flatMap((p: any) => p.pipeline_phases || [])
              .find((ph: any) => ph.id === configPhaseId);
            if (!phase) return null;
            return (
              <>
                <SheetHeader>
                  <SheetTitle>Configurações da fase</SheetTitle>
                  <SheetDescription>Edite os parâmetros — alterações são salvas automaticamente.</SheetDescription>
                </SheetHeader>
                <div className="space-y-5 mt-6">
                  <div className="space-y-1">
                    <Label className="text-sm">Nome</Label>
                    <Input
                      defaultValue={phase.name}
                      key={`name-${phase.id}-${phase.name}`}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== phase.name) updatePhase.mutate({ id: phase.id, name: v });
                      }}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm">Tipo da fase</Label>
                    <Select
                      value={phase.phase_type}
                      onValueChange={(v) => updatePhase.mutate({ id: phase.id, phase_type: v as any })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eliminatoria">Eliminatória</SelectItem>
                        <SelectItem value="classificatoria">Classificatória</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm">Categoria</Label>
                    <Select
                      value={(phase as any).phase_kind || "avaliacao"}
                      onValueChange={(v) => updatePhase.mutate({ id: phase.id, phase_kind: v as any })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="triagem">Triagem (antes da escolha de unidade)</SelectItem>
                        <SelectItem value="avaliacao">Teste pré-entrevista</SelectItem>
                        <SelectItem value="entrevista">Entrevista</SelectItem>
                        <SelectItem value="avaliacao_pos_entrevista">Teste pós-entrevista</SelectItem>
                        <SelectItem value="documentacao">Documentação</SelectItem>
                        <SelectItem value="resultado">Resultado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm">Score mínimo (0–100)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={phase.min_score}
                      key={`score-${phase.id}-${phase.min_score}`}
                      onBlur={(e) => {
                        const val = Math.round(Math.min(100, Math.max(0, Number(e.target.value))));
                        if (val !== phase.min_score) updatePhase.mutate({ id: phase.id, min_score: val });
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between border-t pt-4">
                    <div>
                      <Label className="text-sm">Fase ativa</Label>
                      <p className="text-xs text-muted-foreground">Fases inativas não aparecem para o candidato.</p>
                    </div>
                    <Switch
                      checked={phase.is_active !== false}
                      onCheckedChange={(v) => updatePhase.mutate({ id: phase.id, is_active: v } as any)}
                    />
                  </div>

                  <div className="border-t pt-4">
                    <Label className="text-sm">Etapas ({phase.pipeline_steps.length})</Label>
                    <p className="text-xs text-muted-foreground mb-2">Clique no lápis ao lado de cada etapa no painel principal para editar perguntas.</p>
                    <ul className="space-y-1 text-xs">
                      {phase.pipeline_steps.map((s: any, i: number) => (
                        <li key={s.id} className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px]">{i + 1}</Badge>
                          <span className="truncate flex-1">{s.title}</span>
                          <Badge variant="secondary" className="text-[9px]">{s.type}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border-t pt-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        if (confirm("Excluir fase e todas as etapas?")) {
                          const pipelineId = pipelines?.find((p: any) => p.pipeline_phases.some((ph: any) => ph.id === phase.id))?.id;
                          deletePhase.mutate({ id: phase.id, name: phase.name, pipelineId });
                          setConfigPhaseId(null);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />Excluir fase
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Step Dialog (Create & Edit) */}
      <Dialog open={stepDialogOpen} onOpenChange={(open) => { setStepDialogOpen(open); if (!open) { setEditingStepId(null); setStepData({ title: "", type: "texto", weight: 2, content: {}, phaseId: "", is_optional: false, is_automated: true, conditions: null }); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingStepId ? "Editar bloco de perguntas" : "Novo bloco de perguntas"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {(() => {
              const linkedPhase = pipelines
                ?.flatMap((p: any) => p.pipeline_phases || [])
                .find((ph: any) => ph.id === stepData.phaseId);
              if (!linkedPhase) return null;
              return (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Fase vinculada: </span>
                  <span className="font-medium">{linkedPhase.name}</span>
                </div>
              );
            })()}
            <div>
              <Label>Tipo</Label>
              <Select value={stepData.type} onValueChange={(v) => setStepData({ ...stepData, type: v, content: {} })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STEP_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(stepData.type === "quiz" || stepData.type === "true_false") ? (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Em etapas <strong>{stepData.type === "true_false" ? "Verdadeiro / Falso" : "Quiz"}</strong>, o peso é definido por <strong>cada alternativa</strong> (Alto/Médio/Baixo). Não há peso por pergunta.
              </div>
            ) : (
              <div>
                <Label>Peso da Pergunta</Label>
                <Select value={String(stepData.weight)} onValueChange={(v) => setStepData({ ...stepData, weight: Number(v) })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o peso" />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Baixo = etapa pouco crítica · Médio = relevante · Alto = decisiva
                </p>
              </div>
            )}
            <StepContentEditor
              type={stepData.type}
              content={stepData.content}
              onChange={(content) => setStepData((prev) => ({ ...prev, content }))}
              isOptional={stepData.is_optional}
              onOptionalChange={(val) => setStepData((prev) => ({ ...prev, is_optional: val }))}
              isAutomated={stepData.is_automated}
              onAutomatedChange={(val) => setStepData((prev) => ({ ...prev, is_automated: val }))}
              conditions={stepData.conditions}
              onConditionsChange={(val) => setStepData((prev) => ({ ...prev, conditions: val }))}
            />
            <Button onClick={handleSaveStep} className="w-full">
              {editingStepId ? "Salvar Alterações" : "Criar Etapa"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Score Simulator */}
      {/* Score Simulator - pass active pipeline phases */}
      {pipelines && pipelines.length > 0 && (
        <ScoreSimulator phases={pipelines.find((p: any) => p.is_active)?.pipeline_phases || pipelines[0]?.pipeline_phases || []} />
      )}

      {/* Double Confirm Delete Pipeline */}
      <DoubleConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title={`Excluir Pipeline "${deleteTarget?.name || ""}"`}
        description="Esta ação irá excluir o pipeline e todas as suas fases e etapas. Esta ação é irreversível."
        skipTextConfirm
        loading={deletePipelineMut.isPending}
        confirmLabel={`Excluir "${deleteTarget?.name || "pipeline"}"`}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deletePipelineMut.mutateAsync({ id: deleteTarget.id, name: deleteTarget.name });
            toast.success("Pipeline excluído com sucesso");
            setDeleteTarget(null);
          } catch (e: any) {
            const msg = String(e?.message || "");
            if (msg.includes("foreign key") || e?.code === "23503") {
              toast.error("Existem candidatos vinculados a este pipeline. Finalize-os antes de excluir.");
            } else {
              toast.error(msg || "Erro ao excluir pipeline");
            }
          }
        }}
      />

      {/* Double Confirm Delete Phase */}
      <DoubleConfirmDialog
        open={!!deletePhaseTarget}
        onOpenChange={(v) => { if (!v) setDeletePhaseTarget(null); }}
        title={`Excluir fase "${deletePhaseTarget?.name || ""}"`}
        description="Esta ação irá excluir a fase e todas as suas etapas. Esta ação é irreversível."
        skipTextConfirm
        loading={deletePhase.isPending}
        confirmLabel="Excluir fase"
        onConfirm={async () => {
          if (!deletePhaseTarget) return;
          try {
            await deletePhase.mutateAsync({ id: deletePhaseTarget.id, name: deletePhaseTarget.name, pipelineId: deletePhaseTarget.pipelineId });
            toast.success("Fase excluída");
            setDeletePhaseTarget(null);
          } catch (e: any) {
            toast.error(e?.message || "Erro ao excluir fase");
          }
        }}
      />

      {/* Double Confirm Delete Step */}
      <DoubleConfirmDialog
        open={!!deleteStepTarget}
        onOpenChange={(v) => { if (!v) setDeleteStepTarget(null); }}
        title={`Excluir etapa "${deleteStepTarget?.title || ""}"`}
        description="Esta ação irá excluir a etapa e suas perguntas. Esta ação é irreversível."
        skipTextConfirm
        loading={deleteStep.isPending}
        confirmLabel="Excluir etapa"
        onConfirm={async () => {
          if (!deleteStepTarget) return;
          try {
            await deleteStep.mutateAsync({ id: deleteStepTarget.id, title: deleteStepTarget.title });
            toast.success("Etapa excluída");
            setDeleteStepTarget(null);
          } catch (e: any) {
            toast.error(e?.message || "Erro ao excluir etapa");
          }
        }}
      />
    </div>
  );
}
