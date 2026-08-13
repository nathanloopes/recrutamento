import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAllInterviewGuides, useCreateGuide, useUpdateGuide, useDeleteGuide } from "@/hooks/useInterviewGuides";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useJobs } from "@/hooks/useJobs";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2, Edit, Loader2, BookOpen, BarChart3, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { PageHelp } from "@/components/ui/page-help";
import { InterviewDashboardFranqueadora } from "@/components/admin/InterviewDashboardFranqueadora";
import TestGuidesTab from "@/components/admin/TestGuidesTab";

interface GuideBlock {
  name: string;
  questions: { id: string; text: string; required: boolean; criterion_id?: string | null }[];
  criteria: { id: string; label: string; scale: string[]; complexity?: string }[];
}

const DEFAULT_SCALE = ["alto", "medio", "baixo"];
const COMPLEXITY_LEVELS = [
  { value: "alto", label: "Alto" },
  { value: "medio", label: "Médio" },
  { value: "baixo", label: "Baixo" },
];

// Normaliza escala legada (adequado/atencao/critico) para nova (alto/medio/baixo)
const LEGACY_SCALE_MAP: Record<string, string> = {
  adequado: "alto",
  atencao: "medio",
  critico: "baixo",
};
function normalizeScale(scale: string[] | undefined): string[] {
  if (!Array.isArray(scale) || scale.length === 0) return [...DEFAULT_SCALE];
  return scale.map((v) => LEGACY_SCALE_MAP[v] || v);
}

export default function InterviewGuides() {
  const { isAdmin, hasRole } = useAuth();
  const canManage = hasRole("admin");
  const [filterJob, setFilterJob] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [blocks, setBlocks] = useState<GuideBlock[]>([
    { name: "Comunicação", questions: [], criteria: [] },
  ]);

  const { data: guides, isLoading } = useAllInterviewGuides(filterJob === "all" ? undefined : filterJob);
  const { data: jobs } = useJobs();
  const createGuide = useCreateGuide();
  const updateGuide = useUpdateGuide();
  const deleteGuide = useDeleteGuide();

  const resetForm = () => {
    setEditingId(null);
    setSelectedJobId("");
    setIsActive(true);
    setBlocks([{ name: "Comunicação", questions: [], criteria: [] }]);
  };

  const openEdit = (guide: any) => {
    setEditingId(guide.id);
    setSelectedJobId(guide.job_id);
    setIsActive(guide.is_active);
    const json = guide.guide_json || { blocks: [] };
    const rawBlocks: GuideBlock[] = json.blocks?.length ? json.blocks : [{ name: "Comunicação", questions: [], criteria: [] }];
    // Normaliza roteiros legados: escala antiga + perguntas sem criterion_id
    const normalized = rawBlocks.map((b: any) => ({
      ...b,
      questions: (b.questions || []).map((q: any) => ({
        id: q.id,
        text: q.text || "",
        required: !!q.required,
        criterion_id: q.criterion_id ?? null,
      })),
      criteria: (b.criteria || []).map((c: any) => ({
        id: c.id,
        label: c.label || "",
        scale: normalizeScale(c.scale),
        complexity: LEGACY_SCALE_MAP[c.complexity] || c.complexity || "medio",
      })),
    }));
    setBlocks(normalized);
    setDialogOpen(true);
  };

  const addBlock = () => {
    setBlocks([...blocks, { name: "", questions: [], criteria: [] }]);
  };

  const removeBlock = (idx: number) => {
    setBlocks(blocks.filter((_, i) => i !== idx));
  };

  const updateBlockName = (idx: number, name: string) => {
    const updated = [...blocks];
    updated[idx].name = name;
    setBlocks(updated);
  };

  const addQuestion = (blockIdx: number) => {
    const updated = [...blocks];
    const id = `q${Date.now()}`;
    updated[blockIdx].questions.push({ id, text: "", required: false, criterion_id: null });
    setBlocks(updated);
  };

  const removeQuestion = (blockIdx: number, qIdx: number) => {
    const updated = [...blocks];
    updated[blockIdx].questions.splice(qIdx, 1);
    setBlocks(updated);
  };

  const updateQuestion = (blockIdx: number, qIdx: number, field: string, value: any) => {
    const updated = [...blocks];
    (updated[blockIdx].questions[qIdx] as any)[field] = value;
    setBlocks(updated);
  };

  const addCriterion = (blockIdx: number) => {
    const updated = [...blocks];
    const id = `c${Date.now()}`;
    updated[blockIdx].criteria.push({ id, label: "", scale: [...DEFAULT_SCALE], complexity: "medio" });
    updated[blockIdx].questions = updated[blockIdx].questions.map((q) =>
      q.criterion_id ? q : { ...q, criterion_id: id }
    );
    setBlocks(updated);
  };

  const removeCriterion = (blockIdx: number, cIdx: number) => {
    const updated = [...blocks];
    const removedId = updated[blockIdx].criteria[cIdx]?.id;
    updated[blockIdx].criteria.splice(cIdx, 1);
    // Limpa vínculo órfão das perguntas
    if (removedId) {
      updated[blockIdx].questions = updated[blockIdx].questions.map((q) =>
        q.criterion_id === removedId ? { ...q, criterion_id: null } : q
      );
    }
    setBlocks(updated);
  };

  const updateCriterionLabel = (blockIdx: number, cIdx: number, label: string) => {
    const updated = [...blocks];
    updated[blockIdx].criteria[cIdx].label = label;
    setBlocks(updated);
  };

  const updateCriterionComplexity = (blockIdx: number, cIdx: number, complexity: string) => {
    const updated = [...blocks];
    updated[blockIdx].criteria[cIdx].complexity = complexity;
    updated[blockIdx].criteria[cIdx].scale = [...DEFAULT_SCALE];
    setBlocks(updated);
  };

  const handleSave = async () => {
    if (!selectedJobId) { toast.error("Selecione um cargo"); return; }
    if (!blocks.length || !blocks[0].name) { toast.error("Adicione pelo menos um bloco"); return; }

    const guide_json = {
      blocks: blocks.map((block) => {
        const fallbackCriterionId = block.criteria[0]?.id || null;
        return {
          ...block,
          questions: block.questions
            .filter((q) => q.text.trim())
            .map((q) => ({
              ...q,
              criterion_id: q.criterion_id || fallbackCriterionId,
            })),
        };
      }),
    };
    try {
      if (editingId) {
        await updateGuide.mutateAsync({ id: editingId, guide_json, is_active: isActive });
        toast.success("Roteiro atualizado!");
      } else {
        await createGuide.mutateAsync({ job_id: selectedJobId, guide_json, is_active: isActive });
        toast.success("Roteiro criado!");
      }
      setDialogOpen(false);
      resetForm();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Roteiros de Entrevista</h1>
          <p className="text-muted-foreground text-sm">Gerencie guias de entrevista por cargo</p>
        </div>
        <PageHelp />
      </div>

      <Tabs defaultValue="roteiros">
        <TabsList>
          <TabsTrigger value="roteiros"><BookOpen className="h-4 w-4 mr-1" /> Roteiro de Entrevista</TabsTrigger>
          <TabsTrigger value="testes"><ClipboardList className="h-4 w-4 mr-1" /> Roteiro de Teste</TabsTrigger>
          <TabsTrigger value="dashboard"><BarChart3 className="h-4 w-4 mr-1" /> Dashboard Franqueadora</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <InterviewDashboardFranqueadora />
        </TabsContent>

        <TabsContent value="testes">
          <TestGuidesTab />
        </TabsContent>


        <TabsContent value="roteiros" className="space-y-4">

      <div className="flex gap-3 items-end">
        <div className="w-64">
          <Label>Filtrar por cargo</Label>
          <Select value={filterJob} onValueChange={setFilterJob}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {jobs?.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
          {canManage && (
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />Novo Roteiro</Button>
            </DialogTrigger>
          )}
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{!canManage ? "Visualizar Roteiro" : editingId ? "Editar Roteiro" : "Novo Roteiro"}</DialogTitle></DialogHeader>
            {!canManage ? (
              <div className="space-y-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Cargo: </span>
                  <span className="font-medium text-foreground">
                    {jobs?.find((j: any) => j.id === selectedJobId)?.title || "—"}
                  </span>
                </div>
                {blocks.map((block, bIdx) => (
                  <Card key={bIdx}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{block.name || "Bloco"}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {block.questions.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">Sem perguntas cadastradas.</p>
                      ) : (
                        <ol className="space-y-2 list-decimal list-inside">
                          {block.questions.map((q) => {
                            const criterionLabel = block.criteria.find((c) => c.id === q.criterion_id)?.label;
                            return (
                              <li key={q.id} className="text-sm text-foreground">
                                <span>{q.text || "—"}</span>
                                {criterionLabel && (
                                  <Badge variant="secondary" className="ml-2 text-xs font-normal">
                                    {criterionLabel}
                                  </Badge>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <fieldset className="space-y-4">
              <div>
                <Label>Cargo</Label>
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {jobs?.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <Label>Ativo</Label>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-base font-semibold">Blocos</Label>
                  <Button variant="outline" size="sm" onClick={addBlock}><Plus className="h-3 w-3 mr-1" />Bloco</Button>
                </div>

                {blocks.map((block, bIdx) => (
                  <Card key={bIdx}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-center">
                        <Input
                          placeholder="Nome do bloco (ex: Comunicação)"
                          value={block.name}
                          onChange={(e) => updateBlockName(bIdx, e.target.value)}
                          className="max-w-xs"
                        />
                        <Button variant="ghost" size="icon" onClick={() => removeBlock(bIdx)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Critérios primeiro: definem o que será avaliado */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <Label className="text-sm">Critérios (nível de complexidade)</Label>
                          <Button variant="ghost" size="sm" onClick={() => addCriterion(bIdx)}>
                            <Plus className="h-3 w-3 mr-1" />Critério
                          </Button>
                        </div>
                        {block.criteria.map((c, cIdx) => (
                          <div key={c.id} className="flex gap-2 items-center mb-2">
                            <Input
                              placeholder="Nome do critério (ex: Clareza)"
                              value={c.label}
                              onChange={(e) => updateCriterionLabel(bIdx, cIdx, e.target.value)}
                              className="flex-1"
                            />
                            <Select
                              value={c.complexity || "medio"}
                              onValueChange={(v) => updateCriterionComplexity(bIdx, cIdx, v)}
                            >
                              <SelectTrigger className="w-[180px] h-9 text-xs">
                                <SelectValue placeholder="Nível de complexidade" />
                              </SelectTrigger>
                              <SelectContent>
                                {COMPLEXITY_LEVELS.map((level) => (
                                  <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" onClick={() => removeCriterion(bIdx, cIdx)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>

                      {/* Perguntas vinculadas a critérios */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <Label className="text-sm">Perguntas</Label>
                          <Button variant="ghost" size="sm" onClick={() => addQuestion(bIdx)} disabled={block.criteria.length === 0}>
                            <Plus className="h-3 w-3 mr-1" />Pergunta
                          </Button>
                        </div>
                        {block.criteria.length === 0 && block.questions.length === 0 && (
                          <p className="text-xs text-muted-foreground italic">Crie um critério antes de adicionar perguntas.</p>
                        )}
                        {block.questions.map((q, qIdx) => (
                          <div key={q.id} className="flex gap-2 items-start mb-2">
                            <Textarea
                              placeholder="Texto da pergunta"
                              value={q.text}
                              onChange={(e) => updateQuestion(bIdx, qIdx, "text", e.target.value)}
                              className="min-h-[40px] flex-1"
                            />
                            <Select
                              value={q.criterion_id || "__none__"}
                              onValueChange={(v) => updateQuestion(bIdx, qIdx, "criterion_id", v === "__none__" ? null : v)}
                              disabled={block.criteria.length === 0}
                            >
                              <SelectTrigger className="w-[160px] h-9 text-xs">
                                <SelectValue placeholder={block.criteria.length === 0 ? "Crie critério" : "Critério"} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Sem critério</SelectItem>
                                {block.criteria.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.label || "Sem nome"}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <label className="flex items-center gap-1 text-xs whitespace-nowrap pt-2">
                              <input
                                type="checkbox"
                                checked={q.required}
                                onChange={(e) => updateQuestion(bIdx, qIdx, "required", e.target.checked)}
                              />
                              Obrig.
                            </label>
                            <Button variant="ghost" size="icon" onClick={() => removeQuestion(bIdx, qIdx)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Button className="w-full" onClick={handleSave} disabled={createGuide.isPending || updateGuide.isPending}>
                {(createGuide.isPending || updateGuide.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editingId ? "Atualizar" : "Criar Roteiro"}
              </Button>
              </fieldset>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Roteiros Cadastrados</CardTitle><CardDescription>Lista de guias de entrevista</CardDescription></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !guides?.length ? (
            <p className="text-muted-foreground text-sm text-center py-4">Nenhum roteiro cadastrado.</p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cargo</TableHead>
                  {canManage && <TableHead>Versão</TableHead>}
                  <TableHead>Blocos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guides.map((g: any) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.jobs?.title || "—"}</TableCell>
                    {canManage && <TableCell>v{g.version}</TableCell>}
                    <TableCell>{g.guide_json?.blocks?.length || 0} blocos</TableCell>
                    <TableCell>
                      <Badge variant={g.is_active ? "default" : "secondary"}>
                        {g.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(g)} title={canManage ? "Editar" : "Visualizar"}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir roteiro</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir este roteiro? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={async () => {
                                  try {
                                    await deleteGuide.mutateAsync(g.id);
                                    toast.success("Roteiro excluído!");
                                  } catch (e: any) {
                                    const msg = String(e?.message || "");
                                    if (msg.includes("interview_feedback_guide_id_fkey") || msg.includes("foreign key")) {
                                      toast.error("Este roteiro já foi usado em entrevistas com feedback registrado e não pode ser excluído. Você pode desativá-lo para que não apareça em novas entrevistas.");
                                    } else {
                                      toast.error(msg || "Não foi possível excluir o roteiro.");
                                    }
                                  }
                                }}
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
