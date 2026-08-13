import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trash2, Edit, FileText, Brain, Sparkles, Package, Tag, ClipboardList, Briefcase, Mic, User, Filter, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useJobs } from "@/hooks/useJobs";
import { AITestBuilderTab } from "@/components/admin/ai/AITestBuilderTab";
import { useTestTemplates, useCreateTestTemplate, useUpdateTestTemplate, useDeleteTestTemplate, useTestAssignments, useEvaluateTestAssignment, useGradeEssay, type TestTemplate } from "@/hooks/useTests";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { useTestPacks, useCreateTestPack, useUpdateTestPack, useDeleteTestPack, type TestPack } from "@/hooks/useTestPacks";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PageHelp } from "@/components/ui/page-help";
import { formatDateBR } from "@/lib/dateUtils";

const CATEGORIES = [
  { value: "comportamental", label: "Comportamental" },
  { value: "tecnico", label: "Técnico" },
  { value: "logica", label: "Lógica" },
  { value: "cultura", label: "Cultura" },
  { value: "outro", label: "Outro" },
];

const LEVELS = [
  { value: "todos", label: "Todos" },
  { value: "junior", label: "Júnior" },
  { value: "pleno", label: "Pleno" },
  { value: "senior", label: "Sênior" },
];

const SUBCATEGORIES = [
  { value: "operacao_loja", label: "Operação de Loja", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "administrativo", label: "Administrativo", color: "bg-violet-100 text-violet-700 border-violet-200" },
  { value: "gestao", label: "Gestão", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "comercial", label: "Comercial", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { value: "logistica", label: "Logística", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "ti", label: "Tecnologia", color: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  { value: "outro", label: "Outro", color: "bg-gray-100 text-gray-700 border-gray-200" },
];

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em Andamento",
  enviado: "Enviado",
  corrigido: "Corrigido",
  aprovado: "Aprovado",
  reprovado: "Em Revisão",
  pendente_revisao: "Pendente Revisão IA",
};

interface QuizQuestion {
  text: string;
  type: "multiple_choice" | "true_false" | "essay" | "scenario" | "scale" | "voice_question" | "voice";
  options: { text: string; correct?: boolean }[];
  rubric?: string;
  context?: string;
  scale_labels?: { min: string; max: string };
}

export default function TestManagement() {
  const [tab, setTab] = useState("templates");
  const { isAdmin, hasRole } = useAuth();
  const canManage = hasRole("admin");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-foreground">Testes</h1>
        <PageHelp />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates">Biblioteca</TabsTrigger>
          <TabsTrigger value="packs" className="gap-1"><Package className="h-3.5 w-3.5" />Pacotes</TabsTrigger>
          <TabsTrigger value="atribuicoes">Atribuições</TabsTrigger>
          {canManage && (
            <TabsTrigger value="construtor" className="gap-1"><ClipboardList className="h-3.5 w-3.5" />Construtor</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="packs"><PacksTab /></TabsContent>
        <TabsContent value="atribuicoes"><AssignmentsTab /></TabsContent>
        {canManage && <TabsContent value="construtor"><AITestBuilderTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

// ---- Templates Tab (Biblioteca) ----

function TemplatesTab() {
  const { data: templates, isLoading } = useTestTemplates();
  const createMutation = useCreateTestTemplate();
  const updateMutation = useUpdateTestTemplate();
  const deleteMutation = useDeleteTestTemplate();
  const { user, isAdmin, hasRole } = useAuth();
  const canManage = hasRole("admin");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TestTemplate | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterLevel, setFilterLevel] = useState("all");
  const [filterSubcategory, setFilterSubcategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "quiz" as "quiz" | "file" | "voice",
    category: "outro",
    subcategory: "outro",
    time_limit_minutes: "" as string,
    level: "todos",
    tags: "",
    estimated_time_minutes: "" as string,
    job_ids: [] as string[],
    execution_mode: "form" as "form" | "chatbox",
    questions: [{ text: "", type: "multiple_choice" as const, options: [{ text: "", correct: false }, { text: "", correct: false }], rubric: "" }] as QuizQuestion[],
  });
  const { data: allJobs } = useJobs(true);
  const [filterJob, setFilterJob] = useState("all");

  const resetForm = () => {
    setForm({
      title: "", description: "", type: "quiz" as "quiz" | "file" | "voice", category: "outro", subcategory: "outro", time_limit_minutes: "",
      level: "todos", tags: "", estimated_time_minutes: "", job_ids: [], execution_mode: "form" as "form" | "chatbox",
      questions: [{ text: "", type: "multiple_choice" as const, options: [{ text: "", correct: false }, { text: "", correct: false }], rubric: "" }],
    });
    setEditing(null);
  };

  const openEdit = (t: TestTemplate) => {
    setEditing(t);
    const rawQuestions = (t.type === "quiz" || t.type === "voice") && t.content?.questions ? t.content.questions : [];
    const questions: QuizQuestion[] = (Array.isArray(rawQuestions) ? rawQuestions : []).map((q: any) => {
      const hasPopulatedOptions = Array.isArray(q.options) && q.options.length > 0 && q.options.some((o: any) => o?.text);

      let editorType: "multiple_choice" | "essay" | "voice_question" = "multiple_choice";
      if (q.type === "voice_question" || q.type === "voice") {
        editorType = "voice_question";
      } else if (hasPopulatedOptions) {
        editorType = "multiple_choice";
      } else if (q.type === "essay" || !hasPopulatedOptions) {
        editorType = "essay";
      }
      return {
        text: q.text || "",
        type: editorType,
        options: editorType === "multiple_choice" && hasPopulatedOptions
          ? q.options.map((o: any) => ({ text: o?.text || "", correct: !!o?.correct }))
          : [{ text: "", correct: false }, { text: "", correct: false }],
        rubric: q.rubric || q.context || q.block || "",
      };
    });
    if (questions.length === 0) questions.push({ text: "", type: "multiple_choice", options: [{ text: "", correct: false }, { text: "", correct: false }], rubric: "" });
    setForm({
      title: t.title, description: t.description, type: t.type, category: t.category,
      subcategory: (t as any).subcategory || "outro",
      time_limit_minutes: t.time_limit_minutes?.toString() || "",
      level: (t as any).level || "todos",
      tags: ((t as any).tags || []).join(", "),
      estimated_time_minutes: (t as any).estimated_time_minutes?.toString() || "",
      job_ids: (t as any).job_ids || [],
      execution_mode: (t as any).execution_mode || "form",
      questions,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    const content = (form.type === "quiz" || form.type === "voice")
      ? {
          questions: form.questions.map((q, i) => {
            if (q.type === "voice_question" || q.type === "voice") {
              return { id: `vq_${i}`, text: q.text, type: "voice", max_seconds: 120, weight: 1, rubric: q.rubric || undefined, block: q.rubric || undefined };
            }
            return { ...q, type: q.type || "multiple_choice" };
          }),
          allow_repeat: true,
        }
      : {};
    const parsedTags = form.tags.split(",").map(t => t.trim()).filter(Boolean);
    const payload: any = {
      title: form.title, description: form.description, type: form.type, category: form.category,
      subcategory: form.subcategory,
      time_limit_minutes: form.time_limit_minutes ? parseInt(form.time_limit_minutes) : null,
      level: form.level,
      tags: parsedTags,
      estimated_time_minutes: form.estimated_time_minutes ? parseInt(form.estimated_time_minutes) : null,
      job_ids: form.job_ids,
      execution_mode: form.execution_mode,
      content,
    };
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...payload });
        toast({ title: "Template atualizado" });
      } else {
        await createMutation.mutateAsync({ ...payload, created_by: user?.id });
        toast({ title: "Template criado" });
      }
      setDialogOpen(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  const addQuestion = () => setForm(f => ({ ...f, questions: [...f.questions, { text: "", type: "multiple_choice" as const, options: [{ text: "", correct: false }, { text: "", correct: false }], rubric: "" }] }));
  const removeQuestion = (i: number) => setForm(f => ({ ...f, questions: f.questions.filter((_, idx) => idx !== i) }));
  const updateQuestion = (i: number, text: string) => setForm(f => ({ ...f, questions: f.questions.map((q, idx) => idx === i ? { ...q, text } : q) }));
  const addOption = (qi: number) => setForm(f => ({ ...f, questions: f.questions.map((q, idx) => idx === qi ? { ...q, options: [...(q.options || []), { text: "", correct: false }] } : q) }));
  const removeOption = (qi: number, oi: number) => setForm(f => ({ ...f, questions: f.questions.map((q, idx) => idx === qi ? { ...q, options: (q.options || []).filter((_, oIdx) => oIdx !== oi) } : q) }));
  const updateOption = (qi: number, oi: number, text: string) => setForm(f => ({ ...f, questions: f.questions.map((q, idx) => idx === qi ? { ...q, options: (q.options || []).map((o, oIdx) => oIdx === oi ? { ...o, text } : o) } : q) }));
  const toggleCorrect = (qi: number, oi: number) => setForm(f => ({ ...f, questions: f.questions.map((q, idx) => idx === qi ? { ...q, options: (q.options || []).map((o, oIdx) => oIdx === oi ? { ...o, correct: !o.correct } : o) } : q) }));

  const filtered = templates?.filter(t => {
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    if (filterLevel !== "all" && (t as any).level !== filterLevel) return false;
    if (filterSubcategory !== "all" && (t as any).subcategory !== filterSubcategory) return false;
    if (filterJob !== "all") {
      const tJobIds = (t as any).job_ids || [];
      if (!tJobIds.includes(filterJob)) return false;
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchTitle = t.title.toLowerCase().includes(term);
      const matchTags = ((t as any).tags || []).some((tag: string) => tag.toLowerCase().includes(term));
      if (!matchTitle && !matchTags) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Input
          placeholder="Buscar por título ou tag..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full"
        />
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterLevel} onValueChange={setFilterLevel}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Nível" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos níveis</SelectItem>
            {LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSubcategory} onValueChange={setFilterSubcategory}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Perfil" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos perfis</SelectItem>
            {SUBCATEGORIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterJob} onValueChange={setFilterJob}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Cargo" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos cargos</SelectItem>
            {allJobs?.map(j => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : filtered?.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nenhum template encontrado.</p>
      ) : (
        <div className="grid gap-3">
          {filtered?.map(t => (
            <Card key={t.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(t)}>
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="shrink-0 mt-0.5">
                    {t.type === "quiz" ? <Brain className="h-5 w-5 text-primary" /> : t.type === "voice" ? <Mic className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.description?.slice(0, 80)}</p>
                    {(Array.isArray((t as any).tags) && (t as any).tags.length > 0) && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {((t as any).tags as string[]).slice(0, 3).map((tag, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <Tag className="h-2.5 w-2.5" />{tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {(Array.isArray((t as any).job_ids) && (t as any).job_ids.length > 0) && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {((t as any).job_ids as string[]).slice(0, 3).map((jid) => {
                          const job = allJobs?.find(j => j.id === jid);
                          return job ? (
                            <Badge key={jid} variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 border-primary/30 text-primary">
                              <Briefcase className="h-2.5 w-2.5" />{job.title}
                            </Badge>
                          ) : null;
                        })}
                        {(t as any).job_ids.length > 3 && <Badge variant="outline" className="text-[10px]">+{(t as any).job_ids.length - 3}</Badge>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                  <Badge variant="outline">{CATEGORIES.find(c => c.value === t.category)?.label || t.category}</Badge>
                  {(t as any).subcategory && (t as any).subcategory !== "outro" && (() => {
                    const sub = SUBCATEGORIES.find(s => s.value === (t as any).subcategory);
                    return sub ? <Badge className={`${sub.color} border text-[10px]`}>{sub.label}</Badge> : null;
                  })()}
                  {(t as any).level && (t as any).level !== "todos" && (
                    <Badge variant="secondary">{LEVELS.find(l => l.value === (t as any).level)?.label || (t as any).level}</Badge>
                  )}
                  {(t as any).estimated_time_minutes && (
                    <Badge variant="outline" className="text-[10px]">~{(t as any).estimated_time_minutes}min</Badge>
                  )}
                  <Badge variant={t.is_active ? "default" : "secondary"}>{t.is_active ? "Ativo" : "Inativo"}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{!canManage ? "Visualizar Template" : editing ? "Editar Template" : "Novo Template de Teste"}</DialogTitle>
          </DialogHeader>
          <fieldset disabled={!canManage} className={`space-y-4 disabled:opacity-90 ${!canManage ? "pointer-events-none select-none" : ""}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Comportamental DISC" />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Perfil do Cargo</Label>
                <Select value={form.subcategory} onValueChange={v => setForm(f => ({ ...f, subcategory: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUBCATEGORIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Instruções</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Instruções para o candidato..." />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v: "quiz" | "file" | "voice") => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quiz">Quiz (perguntas)</SelectItem>
                    <SelectItem value="file">Arquivo (PDF)</SelectItem>
                    <SelectItem value="voice">Voz (gravação de áudio)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Modo de Execução</Label>
                <Select value={form.execution_mode} onValueChange={(v: "form" | "chatbox") => setForm(f => ({ ...f, execution_mode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="form">Formulário (lista)</SelectItem>
                    <SelectItem value="chatbox">Chatbox (conversacional)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tempo limite (min)</Label>
                <Input type="number" value={form.time_limit_minutes} onChange={e => setForm(f => ({ ...f, time_limit_minutes: e.target.value }))} placeholder="Sem limite" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Nível</Label>
                <Select value={form.level} onValueChange={v => setForm(f => ({ ...f, level: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tags (vírgula)</Label>
                <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="atendimento, caixa" />
              </div>
              <div className="space-y-2">
                <Label>Tempo estimado (min)</Label>
                <Input type="number" value={form.estimated_time_minutes} onChange={e => setForm(f => ({ ...f, estimated_time_minutes: e.target.value }))} placeholder="Ex: 15" />
              </div>
            </div>

            {/* Vinculação a Cargos */}
            <div className="space-y-2">
              <Label className="text-base font-semibold flex items-center gap-1.5"><Briefcase className="h-4 w-4" />Vincular a Cargos</Label>
              <p className="text-xs text-muted-foreground">Selecione os cargos que utilizarão este teste. Sem seleção = disponível para todos.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-3">
                {allJobs?.map(job => (
                  <div key={job.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`job-${job.id}`}
                      checked={form.job_ids.includes(job.id)}
                      onCheckedChange={(checked) => {
                        setForm(f => ({
                          ...f,
                          job_ids: checked
                            ? [...f.job_ids, job.id]
                            : f.job_ids.filter(id => id !== job.id),
                        }));
                      }}
                    />
                    <label htmlFor={`job-${job.id}`} className="text-sm cursor-pointer">{job.title}</label>
                  </div>
                ))}
                {(!allJobs || allJobs.length === 0) && <p className="text-xs text-muted-foreground col-span-2">Nenhum cargo cadastrado.</p>}
              </div>
              {form.job_ids.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {form.job_ids.map(jid => {
                    const job = allJobs?.find(j => j.id === jid);
                    return job ? <Badge key={jid} variant="outline" className="text-xs gap-1"><Briefcase className="h-3 w-3" />{job.title}</Badge> : null;
                  })}
                </div>
              )}
            </div>

            {(form.type === "quiz" || form.type === "voice") && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Perguntas</Label>
                  <Button size="sm" variant="outline" onClick={addQuestion}><Plus className="h-3 w-3 mr-1" />Pergunta</Button>
                </div>
                {form.questions.map((q, qi) => (
                  <Card key={qi}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground">{qi + 1}.</span>
                        <Input value={q.text} onChange={e => updateQuestion(qi, e.target.value)} placeholder={form.type === "voice" ? "Pergunta que será feita por voz" : "Texto da pergunta"} className="flex-1 min-w-0" />
                        <Select value={q.type || "multiple_choice"} onValueChange={(v: string) => {
                          const updated: QuizQuestion = { ...q, type: v as QuizQuestion["type"] };
                          if (v === "true_false") {
                            updated.options = [{ text: "Verdadeiro", correct: true }, { text: "Falso", correct: false }];
                          } else if (v === "scenario") {
                            updated.context = updated.context || "";
                          } else if (v === "scale") {
                            updated.scale_labels = updated.scale_labels || { min: "1 - Discordo totalmente", max: "5 - Concordo totalmente" };
                          }
                          setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? updated : qq) }));
                        }}>
                          <SelectTrigger className="w-full sm:w-[170px] h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="multiple_choice">☑ Alternativa</SelectItem>
                            <SelectItem value="true_false">☑ Verdadeiro/Falso</SelectItem>
                            <SelectItem value="essay">✍ Dissertativa</SelectItem>
                            <SelectItem value="scenario">📋 Cenário</SelectItem>
                            <SelectItem value="scale">📊 Escala (1-5)</SelectItem>
                            <SelectItem value="voice_question">🎤 Voz (Áudio)</SelectItem>
                          </SelectContent>
                        </Select>
                        {form.questions.length > 1 && (
                          <Button size="icon" variant="ghost" onClick={() => removeQuestion(qi)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        )}
                      </div>
                      {(q.type === "voice_question") ? (
                        <div className="pl-6 space-y-1.5">
                          <Textarea
                            value={q.rubric || ""}
                            onChange={e => setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? { ...qq, rubric: e.target.value } : qq) }))}
                            placeholder="Critérios de avaliação (ex: deve demonstrar experiência em liderança...)"
                            rows={2}
                            className="text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground">🎤 O candidato gravará um áudio respondendo esta pergunta. A IA transcreverá e avaliará.</p>
                        </div>
                      ) : (q.type === "multiple_choice" || q.type === "true_false") ? (
                        <div className="pl-6 space-y-1.5">
                          {(q.options || []).map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <Switch checked={!!opt.correct} onCheckedChange={() => toggleCorrect(qi, oi)} />
                              <Input value={opt.text} onChange={e => updateOption(qi, oi, e.target.value)} placeholder={`Alternativa ${oi + 1}`} className="flex-1 h-8 text-sm" />
                              {(q.options || []).length > 2 && q.type !== "true_false" && (
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeOption(qi, oi)}><Trash2 className="h-3 w-3" /></Button>
                              )}
                            </div>
                          ))}
                          {q.type !== "true_false" && (
                            <Button size="sm" variant="ghost" onClick={() => addOption(qi)} className="text-xs"><Plus className="h-3 w-3 mr-1" />Alternativa</Button>
                          )}
                        </div>
                      ) : q.type === "scenario" ? (
                        <div className="pl-6 space-y-1.5">
                          <Textarea
                            value={q.context || ""}
                            onChange={e => setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? { ...qq, context: e.target.value } : qq) }))}
                            placeholder="Descreva o cenário/situação que o candidato deve analisar..."
                            rows={3}
                            className="text-sm"
                          />
                          <Textarea
                            value={q.rubric || ""}
                            onChange={e => setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? { ...qq, rubric: e.target.value } : qq) }))}
                            placeholder="Critérios de avaliação (ex: deve propor solução prática, demonstrar empatia...)"
                            rows={2}
                            className="text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground">📋 O candidato lerá o cenário e escreverá uma resposta dissertativa.</p>
                        </div>
                      ) : q.type === "scale" ? (
                        <div className="pl-6 space-y-1.5">
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              value={q.scale_labels?.min || ""}
                              onChange={e => setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? { ...qq, scale_labels: { min: e.target.value, max: qq.scale_labels?.max || "" } } : qq) }))}
                              placeholder="Label mínimo (ex: Discordo totalmente)"
                              className="h-8 text-sm"
                            />
                            <Input
                              value={q.scale_labels?.max || ""}
                              onChange={e => setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? { ...qq, scale_labels: { min: qq.scale_labels?.min || "", max: e.target.value } } : qq) }))}
                              placeholder="Label máximo (ex: Concordo totalmente)"
                              className="h-8 text-sm"
                            />
                          </div>
                          <Textarea
                            value={q.rubric || ""}
                            onChange={e => setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? { ...qq, rubric: e.target.value } : qq) }))}
                            placeholder="Critérios de avaliação (opcional)"
                            rows={2}
                            className="text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground">📊 O candidato escolherá um valor de 1 a 5 na escala.</p>
                        </div>
                      ) : (
                        <div className="pl-6 space-y-1.5">
                          <Textarea
                            value={q.rubric || ""}
                            onChange={e => setForm(f => ({ ...f, questions: f.questions.map((qq, idx) => idx === qi ? { ...qq, rubric: e.target.value } : qq) }))}
                            placeholder="Critérios de avaliação para a IA corrigir (ex: deve mencionar atendimento ao cliente, comunicação clara...)"
                            rows={2}
                            className="text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground">A resposta será avaliada pela IA com base nos critérios acima.</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {editing && (
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active} onCheckedChange={async (v) => {
                  try {
                    await updateMutation.mutateAsync({ id: editing.id, is_active: v } as any);
                    setEditing({ ...editing, is_active: v });
                    toast({ title: v ? "Template ativado" : "Template desativado" });
                  } catch {}
                }} />
                <Label>Ativo</Label>
              </div>
            )}
          </fieldset>
          {canManage && (
            <DialogFooter className="flex !justify-between">
              {editing ? (
                <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)} className="mr-auto">
                  <Trash2 className="h-4 w-4 mr-1" /> Excluir
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
                <Button onClick={handleSave} disabled={!form.title.trim()}>
                  {editing ? "Salvar" : "Criar"}
                </Button>
              </div>
            </DialogFooter>
          )}

          <DoubleConfirmDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            title="Excluir template"
            description={`Tem certeza que deseja excluir o template "${editing?.title}"? Ele será desativado e não aparecerá mais na listagem.`}
            skipTextConfirm
            confirmLabel="Excluir template"
            loading={deleteMutation.isPending}
            onConfirm={async () => {
              if (!editing) return;
              try {
                await deleteMutation.mutateAsync(editing.id);
                toast({ title: "Template excluído com sucesso" });
                setDeleteConfirmOpen(false);
                setDialogOpen(false);
                resetForm();
              } catch {
                toast({ title: "Erro ao excluir template", variant: "destructive" });
              }
            }}
          />
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ---- Packs Tab ----

function PacksTab() {
  const { data: packs, isLoading } = useTestPacks();
  const { data: templates } = useTestTemplates();
  const createPack = useCreateTestPack();
  const updatePack = useUpdateTestPack();
  const deletePack = useDeleteTestPack();
  const { user, isAdmin, hasRole } = useAuth();
  const canManage = hasRole("admin");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TestPack | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [packToDelete, setPackToDelete] = useState<TestPack | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    level: "todos",
    template_ids: [] as string[],
    rules: [] as { category: string; count: number }[],
  });

  const resetForm = () => {
    setForm({ name: "", description: "", level: "todos", template_ids: [], rules: [] });
    setEditing(null);
  };

  const openEdit = (p: TestPack) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description,
      level: p.level,
      template_ids: p.template_ids,
      rules: p.rules || [],
    });
    setDialogOpen(true);
  };

  const toggleTemplate = (id: string) => {
    setForm(f => ({
      ...f,
      template_ids: f.template_ids.includes(id)
        ? f.template_ids.filter(t => t !== id)
        : [...f.template_ids, id],
    }));
  };

  const addRule = () => setForm(f => ({ ...f, rules: [...f.rules, { category: "tecnico", count: 1 }] }));
  const removeRule = (i: number) => setForm(f => ({ ...f, rules: f.rules.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      const payload: any = {
        name: form.name,
        description: form.description,
        level: form.level,
        template_ids: form.template_ids,
        rules: form.rules,
      };
      if (editing) {
        await updatePack.mutateAsync({ id: editing.id, ...payload });
        toast({ title: "Pacote atualizado" });
      } else {
        await createPack.mutateAsync({ ...payload, created_by: user?.id });
        toast({ title: "Pacote criado" });
      }
      setDialogOpen(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canManage && (
          <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />Novo Pacote
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : !packs?.length ? (
        <p className="text-center text-muted-foreground py-8">Nenhum pacote criado. Crie pacotes para agrupar testes por nível e categoria.</p>
      ) : (
        <div className="grid gap-3">
          {packs.map(p => (
            <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(p)}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Package className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary">{LEVELS.find(l => l.value === p.level)?.label || p.level}</Badge>
                  <Badge variant="outline">{p.template_ids.length} testes</Badge>
                  {p.rules.length > 0 && <Badge variant="outline">{p.rules.length} regra(s)</Badge>}
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); setPackToDelete(p); setDeleteConfirmOpen(true); }}
                      title="Excluir pacote"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DoubleConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={(o) => { setDeleteConfirmOpen(o); if (!o) setPackToDelete(null); }}
        title="Excluir pacote"
        description={`Tem certeza que deseja excluir o pacote "${packToDelete?.name}"? Essa ação não pode ser desfeita.`}
        skipTextConfirm
        confirmLabel="Excluir pacote"
        loading={deletePack.isPending}
        onConfirm={async () => {
          if (!packToDelete) return;
          try {
            await deletePack.mutateAsync(packToDelete.id);
            toast({ title: "Pacote excluído" });
            setDeleteConfirmOpen(false);
            setPackToDelete(null);
          } catch (e: any) {
            toast({ title: "Erro ao excluir pacote", description: e.message, variant: "destructive" });
          }
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{!canManage ? "Visualizar Pacote" : editing ? "Editar Pacote" : "Novo Pacote de Testes"}</DialogTitle>
          </DialogHeader>
          <fieldset disabled={!canManage} className={`space-y-4 disabled:opacity-90 ${!canManage ? "pointer-events-none select-none" : ""}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Avaliação Caixa - Básico" />
              </div>
              <div className="space-y-2">
                <Label>Nível</Label>
                <Select value={form.level} onValueChange={v => setForm(f => ({ ...f, level: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descrição do pacote..." />
            </div>

            {/* Template selection */}
            <div className="space-y-2">
              <Label>Testes fixos do pacote</Label>
              <ScrollArea className="max-h-48 border rounded-md p-2">
                {templates?.filter(t => t.is_active).map(t => (
                  <div key={t.id} className="flex items-center gap-2 py-1.5 px-1 hover:bg-muted/50 rounded cursor-pointer" onClick={() => toggleTemplate(t.id)}>
                    <Switch checked={form.template_ids.includes(t.id)} onCheckedChange={() => toggleTemplate(t.id)} />
                    <span className="text-sm flex-1">{t.title}</span>
                    <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                  </div>
                ))}
              </ScrollArea>
            </div>

            {/* Rules */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Regras de composição (híbrido IA)</Label>
                <Button size="sm" variant="outline" onClick={addRule}><Plus className="h-3 w-3 mr-1" />Regra</Button>
              </div>
              <p className="text-xs text-muted-foreground">Ao atribuir, a IA sugerirá templates da biblioteca para completar regras sem testes fixos.</p>
              {form.rules.map((rule, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select value={rule.category} onValueChange={v => {
                    const newRules = [...form.rules];
                    newRules[i] = { ...newRules[i], category: v };
                    setForm(f => ({ ...f, rules: newRules }));
                  }}>
                    <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={1} max={5} value={rule.count}
                    onChange={e => {
                      const newRules = [...form.rules];
                      newRules[i] = { ...newRules[i], count: parseInt(e.target.value) || 1 };
                      setForm(f => ({ ...f, rules: newRules }));
                    }}
                    className="w-20" placeholder="Qtd" />
                  <span className="text-xs text-muted-foreground">teste(s)</span>
                  <Button size="icon" variant="ghost" onClick={() => removeRule(i)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>
              ))}
            </div>
          </fieldset>
          {canManage && (
            <DialogFooter className="flex !justify-between">
              {editing ? (
                <Button
                  variant="destructive"
                  onClick={() => { setPackToDelete(editing); setDialogOpen(false); setDeleteConfirmOpen(true); }}
                  className="mr-auto"
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Excluir
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
                <Button onClick={handleSave} disabled={!form.name.trim()}>
                  {editing ? "Salvar" : "Criar"}
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Assignments Tab ----

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  em_andamento: "bg-blue-100 text-blue-800 border-blue-300",
  enviado: "bg-orange-100 text-orange-800 border-orange-300",
  corrigido: "bg-green-100 text-green-800 border-green-300",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-300",
  reprovado: "bg-red-100 text-red-800 border-red-300",
};

function AssignmentsTab() {
  const { data: assignments, isLoading } = useTestAssignments();
  const evaluateMutation = useEvaluateTestAssignment();
  const { user } = useAuth();
  const [evalDialog, setEvalDialog] = useState<any | null>(null);
  const [evalScore, setEvalScore] = useState("");
  const [evalNotes, setEvalNotes] = useState("");
  const [evalStatus, setEvalStatus] = useState("corrigido");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [reprocessing, setReprocessing] = useState(false);

  const pendingReviewCount = assignments?.filter(a => 
    (a.score === 0 || a.score === null) && a.response && a.status !== "pendente" && a.status !== "em_andamento"
  ).length || 0;

  const handleReprocess = async () => {
    setReprocessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("reprocess-test-assignments", {
        body: {},
      });
      if (error) throw error;
      toast({
        title: `Reprocessamento concluído`,
        description: `${data.processed} teste(s) corrigido(s), ${data.failed} erro(s).`,
      });
      // Refresh assignments list
      window.location.reload();
    } catch (e: any) {
      toast({ title: "Erro ao reprocessar", description: e.message, variant: "destructive" });
    } finally {
      setReprocessing(false);
    }
  };

  const handleEvaluate = async () => {
    if (!evalDialog || !user) return;
    try {
      await evaluateMutation.mutateAsync({
        id: evalDialog.id,
        score: parseFloat(evalScore) || 0,
        evaluator_notes: evalNotes,
        status: evalStatus,
        evaluated_by: user.id,
      });
      toast({ title: "Avaliação salva" });
      setEvalDialog(null);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  const filtered = assignments?.filter(a => statusFilter === "todos" || a.status === statusFilter) || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {["todos", "pendente", "em_andamento", "enviado", "corrigido", "pendente_revisao", "aprovado", "reprovado"].map(s => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
              className="text-xs h-7"
            >
              {s === "todos" ? "Todos" : ASSIGNMENT_STATUS_LABELS[s] || s}
            </Button>
          ))}
        </div>
        {pendingReviewCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleReprocess}
            disabled={reprocessing}
            className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reprocessing ? "animate-spin" : ""}`} />
            Reprocessar ({pendingReviewCount})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nenhum teste atribuído.</p>
      ) : (
        <Card>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidato</TableHead>
                  <TableHead>Teste</TableHead>
                  <TableHead>Vaga</TableHead>
                  <TableHead>Atribuído por</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Conclusão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Nota</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={a.candidate_avatar || undefined} />
                          <AvatarFallback className="text-[10px]">
                            {(a.candidate_name || "?").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{a.candidate_name || "—"}</p>
                          {a.candidate_email && <p className="text-[11px] text-muted-foreground truncate">{a.candidate_email}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{a.test_templates?.title || "Teste"}</p>
                      {a.is_mandatory && <span className="text-[10px] text-destructive font-medium">Obrigatório</span>}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">{a.job_title || "—"}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">{a.assigner_name || "—"}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">
                        {a.deadline ? formatDateBR(a.deadline) : "—"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">
                        {a.completed_at ? new Date(a.completed_at).toLocaleDateString("pt-BR") : "—"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${STATUS_COLORS[a.status] || ""}`} variant="outline">
                        {ASSIGNMENT_STATUS_LABELS[a.status] || a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {a.score != null ? (
                        <span className="font-semibold text-primary">{a.score}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {a.status === "enviado" && (
                          <>
                            {a.test_templates?.content?.ai_grading_enabled && (
                              <AIGradeButton assignment={a} />
                            )}
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                              setEvalDialog(a);
                              setEvalScore(a.score?.toString() || "");
                              setEvalNotes(a.evaluator_notes || "");
                              setEvalStatus("corrigido");
                            }}>
                              <Edit className="h-3 w-3 mr-1" />Avaliar
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Dialog open={!!evalDialog} onOpenChange={(o) => !o && setEvalDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Avaliar Teste</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nota (0-100)</Label>
              <Input type="number" min="0" max="100" value={evalScore} onChange={e => setEvalScore(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={evalNotes} onChange={e => setEvalNotes(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={evalStatus} onValueChange={setEvalStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrigido">Corrigido</SelectItem>
                  <SelectItem value="aprovado">Aprovado</SelectItem>
                  <SelectItem value="reprovado">Em Revisão</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvalDialog(null)}>Cancelar</Button>
            <Button onClick={handleEvaluate}>Salvar Avaliação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- AI Grade Button ----

function AIGradeButton({ assignment }: { assignment: any }) {
  const gradeMutation = useGradeEssay();
  const evaluateMutation = useEvaluateTestAssignment();
  const { user } = useAuth();
  const [grading, setGrading] = useState(false);

  const handleGrade = async () => {
    const template = assignment.test_templates;
    const questions = template?.content?.questions || [];
    const candidateAnswers = assignment.response?.answers || {};

    const essayQuestions = questions
      .map((q: any, i: number) => ({ ...q, index: i }))
      .filter((q: any) => ["essay", "scenario"].includes(q.type));

    if (essayQuestions.length === 0) {
      toast({ title: "Nenhuma questão dissertativa para corrigir" });
      return;
    }

    setGrading(true);
    try {
      const result = await gradeMutation.mutateAsync({
        questions: essayQuestions.map((q: any) => ({
          question: q.text,
          rubric: q.rubric,
          candidate_answer: candidateAnswers[q.index] || "",
          max_score: 100,
          context: q.context,
        })),
      });

      const notes = result.results.map((r: any) =>
        `${r.question?.slice(0, 50)}...: ${r.score ?? "N/A"} - ${r.justification || ""}`
      ).join("\n");

      await evaluateMutation.mutateAsync({
        id: assignment.id,
        score: result.summary.average_score,
        evaluator_notes: `[IA] ${notes}`,
        status: "corrigido",
        evaluated_by: user!.id,
      });

      toast({ title: "Correção IA concluída", description: `Nota média: ${result.summary.average_score}` });
    } catch (e: any) {
      toast({ title: "Erro na correção IA", description: e.message, variant: "destructive" });
    }
    setGrading(false);
  };

  return (
    <Button size="sm" variant="outline" onClick={handleGrade} disabled={grading} className="gap-1">
      {grading ? <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" /> : <Sparkles className="h-3 w-3" />}
      Corrigir IA
    </Button>
  );
}
