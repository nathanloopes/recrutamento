import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Sparkles, Plus, Trash2, Save, GripVertical, Tag, CheckCircle2, Info } from "lucide-react";
import { useCreateTestTemplate, useGenerateTest } from "@/hooks/useTests";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/hooks/useJobs";
import { toast } from "@/hooks/use-toast";

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

const QUESTION_TYPES = [
  { value: "multiple_choice", label: "Múltipla Escolha" },
  { value: "true_false", label: "Verdadeiro/Falso" },
  { value: "essay", label: "Dissertativa" },
  { value: "scenario", label: "Cenário Situacional" },
  { value: "scale", label: "Escala (1-5)" },
  { value: "voice_question", label: "Voz (gravação de áudio)" },
];


const DIFFICULTIES = [
  { value: "facil", label: "Fácil", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { value: "medio", label: "Médio", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "dificil", label: "Difícil", color: "bg-red-100 text-red-700 border-red-200" },
];

interface Question {
  type: string;
  text: string;
  context?: string;
  options?: { text: string; correct?: boolean }[];
  scale_labels?: { min: string; max: string };
  weight: number;
  rubric?: string;
  difficulty?: string;
  correct_answer_explanation?: string;
}

export function AITestBuilderTab() {
  const { user } = useAuth();
  const createMutation = useCreateTestTemplate();
  const generateMutation = useGenerateTest();
  const { data: jobs } = useJobs(true);

  const [generateDialog, setGenerateDialog] = useState(false);
  const [genForm, setGenForm] = useState({ job_title: "", category: "tecnico", prompt: "", question_count: 5, difficulty: "medio", subcategory: "outro" });

  const [questions, setQuestions] = useState<Question[]>([]);
  const [passingScore, setPassingScore] = useState(60);
  const [aiGrading, setAiGrading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("tecnico");
  const [timeLimit, setTimeLimit] = useState("");
  const [level, setLevel] = useState("todos");
  const [subcategory, setSubcategory] = useState("outro");
  const [tags, setTags] = useState("");
  const [estimatedTime, setEstimatedTime] = useState("");
  const [jobIds, setJobIds] = useState<string[]>([]);

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync(genForm);
      setQuestions(result.questions || []);
      setPassingScore(result.passing_score || 60);
      setGenerateDialog(false);
      toast({ title: "Teste gerado pela IA!", description: `${result.questions?.length || 0} questões criadas.` });
    } catch (e: any) {
      toast({ title: "Erro na geração", description: e.message, variant: "destructive" });
    }
  };

  const addQuestion = (type: string) => {
    const base: Question = { type, text: "", weight: 1 };
    if (type === "multiple_choice") {
      base.options = [{ text: "", correct: false }, { text: "", correct: false }, { text: "", correct: false }, { text: "", correct: false }];
    } else if (type === "true_false") {
      base.options = [{ text: "Verdadeiro", correct: false }, { text: "Falso", correct: false }];
    } else if (type === "essay") {
      base.rubric = "";
    } else if (type === "scenario") {
      base.context = "";
      base.rubric = "";
    } else if (type === "scale") {
      base.scale_labels = { min: "Discordo totalmente", max: "Concordo totalmente" };
    } else if (type === "voice_question") {
      base.rubric = "";
    }
    setQuestions(prev => [...prev, base]);
  };

  const updateQuestion = (i: number, updates: Partial<Question>) => {
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, ...updates } : q));
  };

  const removeQuestion = (i: number) => setQuestions(prev => prev.filter((_, idx) => idx !== i));

  const getDifficultyStyle = (diff?: string) => {
    return DIFFICULTIES.find(d => d.value === diff) || DIFFICULTIES[1];
  };

  const handleSave = async () => {
    if (!title.trim() || questions.length === 0) {
      toast({ title: "Preencha título e adicione questões", variant: "destructive" });
      return;
    }
    const parsedTags = tags.split(",").map(t => t.trim()).filter(Boolean);
    const content = {
      questions: questions.map((q) => {
        if (q.type === "voice_question") {
          return { ...q, type: "voice" };
        }
        return q;
      }),
      passing_score: passingScore,
      ai_grading_enabled: aiGrading,
    };
    try {
      await createMutation.mutateAsync({
        title,
        description,
        type: "quiz",
        category,
        subcategory,
        time_limit_minutes: timeLimit ? parseInt(timeLimit) : null,
        level,
        tags: parsedTags,
        estimated_time_minutes: estimatedTime ? parseInt(estimatedTime) : null,
        job_ids: jobIds.length > 0 ? jobIds : null,
        content,
        created_by: user?.id,
      } as any);
      toast({ title: "Template salvo com sucesso!" });
      setQuestions([]);
      setTitle("");
      setDescription("");
      setTags("");
      setEstimatedTime("");
      setJobIds([]);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-16rem)]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4">
        <div>
          <h3 className="text-lg font-semibold">Construtor de Testes IA</h3>
          <p className="text-sm text-muted-foreground">Gere testes com IA ou construa manualmente com múltiplos tipos de questão.</p>
        </div>
        <Button onClick={() => setGenerateDialog(true)} className="gap-2">
          <Sparkles className="h-4 w-4" />Gerar com IA
        </Button>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1 -mx-1 px-1">
        <div className="space-y-6 pb-4">
          {/* Test metadata */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Título do Teste</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Avaliação Técnica - Caixa" />
                </div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {/* Seleção de Vagas */}
              {jobs && jobs.length > 0 && (
                <div className="space-y-2">
                  <Label>Vincular a Vagas (opcional)</Label>
                  <p className="text-xs text-muted-foreground">Se nenhuma vaga for selecionada, o teste ficará disponível como template global.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-md p-3">
                    {jobs.map((job: any) => (
                      <label key={job.id} className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox
                          checked={jobIds.includes(job.id)}
                          onCheckedChange={(checked) => {
                            setJobIds(prev =>
                              checked ? [...prev, job.id] : prev.filter(id => id !== job.id)
                            );
                          }}
                        />
                        <span className="truncate">{job.title}</span>
                      </label>
                    ))}
                  </div>
                  {jobIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">{jobIds.length} vaga(s) selecionada(s)</p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label>Instruções para o Candidato</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Instruções gerais do teste..." />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nível</Label>
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Perfil do Cargo</Label>
                  <Select value={subcategory} onValueChange={setSubcategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SUBCATEGORIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Tags (separadas por vírgula)</Label>
                  <div className="relative">
                    <Tag className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="atendimento, liderança" className="pl-8" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Tempo Estimado (min)</Label>
                  <Input type="number" value={estimatedTime} onChange={e => setEstimatedTime(e.target.value)} placeholder="Ex: 15" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Tempo Limite (min)</Label>
                  <Input type="number" value={timeLimit} onChange={e => setTimeLimit(e.target.value)} placeholder="Sem limite" />
                </div>
                <div className="space-y-2">
                  <Label>Nota Mínima (%)</Label>
                  <Input type="number" value={passingScore} onChange={e => setPassingScore(Number(e.target.value))} />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={aiGrading} onCheckedChange={setAiGrading} />
                  <Label>Correção automática por IA</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Questions */}
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Questões ({questions.length})</h4>
            <Select onValueChange={addQuestion}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="+ Adicionar questão" />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {questions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p>Nenhuma questão ainda. Use "Gerar com IA" ou adicione manualmente.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {questions.map((q, i) => {
                const diffStyle = getDifficultyStyle(q.difficulty);
                return (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="outline">{QUESTION_TYPES.find(t => t.value === q.type)?.label || q.type}</Badge>
                          {q.difficulty && (
                            <Badge className={`${diffStyle.color} border text-xs`}>{diffStyle.label}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">Peso: {q.weight}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input type="number" value={q.weight} onChange={e => updateQuestion(i, { weight: Number(e.target.value) || 1 })}
                            className="w-16 h-7 text-xs" min={1} max={10} />
                          <Button size="icon" variant="ghost" onClick={() => removeQuestion(i)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      <Input value={q.text} onChange={e => updateQuestion(i, { text: e.target.value })}
                        placeholder="Texto da pergunta" />

                      {q.type === "scenario" && (
                        <Textarea value={q.context || ""} onChange={e => updateQuestion(i, { context: e.target.value })}
                          placeholder="Contexto do cenário situacional..." className="text-sm" />
                      )}

                      {(q.type === "multiple_choice" || q.type === "true_false") && q.options && (
                        <div className="pl-4 space-y-1.5">
                          {q.options.map((opt, oi) => (
                            <div key={oi} className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${opt.correct ? "bg-emerald-50 border border-emerald-200" : ""}`}>
                              {opt.correct && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                              <Switch checked={!!opt.correct} onCheckedChange={() => {
                                const newOpts = q.options!.map((o, idx) => ({ ...o, correct: idx === oi }));
                                updateQuestion(i, { options: newOpts });
                              }} />
                              <Input value={opt.text} onChange={e => {
                                const newOpts = [...q.options!];
                                newOpts[oi] = { ...newOpts[oi], text: e.target.value };
                                updateQuestion(i, { options: newOpts });
                              }} placeholder={`Alternativa ${oi + 1}`} className="h-8 text-sm flex-1" />
                              {q.type === "multiple_choice" && q.options!.length > 2 && (
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                                  updateQuestion(i, { options: q.options!.filter((_, idx) => idx !== oi) });
                                }}><Trash2 className="h-3 w-3" /></Button>
                              )}
                            </div>
                          ))}
                          {q.type === "multiple_choice" && (
                            <Button size="sm" variant="ghost" className="text-xs" onClick={() => {
                              updateQuestion(i, { options: [...(q.options || []), { text: "", correct: false }] });
                            }}><Plus className="h-3 w-3 mr-1" />Alternativa</Button>
                          )}
                        </div>
                      )}

                      {q.type === "scale" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input value={q.scale_labels?.min || ""} onChange={e => updateQuestion(i, { scale_labels: { min: e.target.value, max: q.scale_labels?.max || "" } })}
                            placeholder="Label mínimo (ex: Discordo)" className="text-sm h-8" />
                          <Input value={q.scale_labels?.max || ""} onChange={e => updateQuestion(i, { scale_labels: { min: q.scale_labels?.min || "", max: e.target.value } })}
                            placeholder="Label máximo (ex: Concordo)" className="text-sm h-8" />
                        </div>
                      )}

                      {(q.type === "essay" || q.type === "scenario" || q.type === "voice_question") && (
                        <Textarea value={q.rubric || ""} onChange={e => updateQuestion(i, { rubric: e.target.value })}
                          placeholder={q.type === "voice_question" ? "Critérios de avaliação da resposta em áudio..." : "Rubrica de avaliação (critérios para correção IA)..."} className="text-sm" rows={2} />
                      )}

                      {/* Correct answer explanation (admin only) */}
                      {q.correct_answer_explanation && (
                        <div className="flex gap-2 items-start rounded-md bg-emerald-50 border border-emerald-200 p-3 mt-1">
                          <Info className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-emerald-700 mb-0.5">Gabarito — Justificativa</p>
                            <p className="text-xs text-emerald-800">{q.correct_answer_explanation}</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Sticky footer */}
      {questions.length > 0 && (
        <div className="sticky bottom-0 pt-4 pb-2 bg-background border-t mt-2 flex flex-wrap items-center gap-3">
          <Button onClick={handleSave} className="gap-2" size="lg" disabled={createMutation.isPending}>
            <Save className="h-4 w-4" />Salvar como Template
          </Button>
          <span className="text-sm text-muted-foreground">{questions.length} questão(ões)</span>
        </div>
      )}

      {/* Generate Dialog */}
      <Dialog open={generateDialog} onOpenChange={setGenerateDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" />Gerar Teste com IA</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Select value={genForm.job_title} onValueChange={v => setGenForm(f => ({ ...f, job_title: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o cargo" /></SelectTrigger>
                <SelectContent>
                  {jobs?.map(j => <SelectItem key={j.id} value={j.title}>{j.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={genForm.category} onValueChange={v => setGenForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Perfil do Cargo</Label>
                <Select value={genForm.subcategory} onValueChange={v => setGenForm(f => ({ ...f, subcategory: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUBCATEGORIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nível de Dificuldade</Label>
                <Select value={genForm.difficulty} onValueChange={v => setGenForm(f => ({ ...f, difficulty: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map(d => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Instruções para a IA gerar o teste (opcional)</Label>
              <Textarea value={genForm.prompt} onChange={e => setGenForm(f => ({ ...f, prompt: e.target.value }))}
                placeholder="Ex: Crie um teste técnico nível sênior focado em liderança, com perguntas situacionais, avaliação comportamental e tomada de decisão."
                rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Quantidade de questões</Label>
              <div className="flex items-center gap-4">
                <Slider value={[genForm.question_count]} onValueChange={([v]) => setGenForm(f => ({ ...f, question_count: v }))}
                  min={3} max={30} step={1} className="flex-1" />
                <span className="text-sm font-mono w-6 text-center">{genForm.question_count}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateDialog(false)}>Cancelar</Button>
            <Button onClick={handleGenerate} disabled={!genForm.job_title.trim() || generateMutation.isPending} className="gap-2">
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
