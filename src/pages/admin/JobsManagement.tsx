import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, History, Search, Briefcase, Building2, CalendarDays, Trash2, MapPin, Sparkles, CheckCircle2, AlertTriangle, GitCompare, SlidersHorizontal } from "lucide-react";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { useNavigate, Link } from "react-router-dom";
import { useJobs, useCreateJob, useUpdateJob, useJobVersions, useDeleteJob } from "@/hooks/useJobs";
import { useDefaultJobAttributes, useDefaultJobAttributesMutations, type DefaultJobAttributeKind } from "@/hooks/useDefaultJobAttributes";
import { Checkbox } from "@/components/ui/checkbox";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHelp } from "@/components/ui/page-help";
import { useValidateJobDescription } from "@/hooks/useValidateJobDescription";
import { useJobsWithTests, jobHasTest, jobHasSpecificTest } from "@/hooks/useJobsWithTests";
import { useAuth } from "@/contexts/AuthContext";
import { useDiscoveryTraits, useDiscoveryTraitsMutations } from "@/hooks/useDiscoveryTraits";
import { UnitOverrideForJobDialog } from "@/components/admin/UnitOverrideForJobDialog";

export default function JobsManagement() {
  const navigate = useNavigate();
  const { hasRole, unitIds } = useAuth();
  const canManage = hasRole("admin");
  const canUseUnitPersonalization = hasRole("rh_franqueadora");
  const { data: unitsConfig } = useGlobalSettings("units");
  const allowedOverrideUnits = (() => {
    const v = unitsConfig?.find((s: any) => s.key === "unit_override_allowed_units")?.value;
    return Array.isArray(v) ? (v as string[]) : [];
  })();
  const allowOverrideFlag = (() => {
    const v = unitsConfig?.find((s: any) => s.key === "allow_unit_override")?.value;
    return v === true || v === "true";
  })();
  const myAllowedUnitIds = allowOverrideFlag && canUseUnitPersonalization ? allowedOverrideUnits : [];
  const canPersonalizeNow = !canManage && canUseUnitPersonalization && myAllowedUnitIds.length > 0;
  const [overrideTarget, setOverrideTarget] = useState<any>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [form, setForm] = useState({ title: "", description: "", requires_ai_interview: false, requires_human_interview: false, allows_career_plan: false, category: "unidade" as string, code: "" as string, min_score: 0 as number, requires_documents: false, sede_only: false, is_active: true, benefits: [] as string[], responsibilities: [] as string[], requirements: [] as string[], discovery_invite: "" as string, discovery_traits: [] as string[], discovery_highlights: [] as string[] });
  const [customBenefit, setCustomBenefit] = useState("");
  const [customResponsibility, setCustomResponsibility] = useState("");
  const [customRequirement, setCustomRequirement] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [deactivateJob, setDeactivateJob] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [diffVersions, setDiffVersions] = useState<[any, any] | null>(null);

  const { data: jobs, isLoading } = useJobs(showInactive ? undefined : true);
  const createJob = useCreateJob();
  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();
  const { data: jobsConfig } = useGlobalSettings("jobs");
  const { data: versions, isLoading: versionsLoading } = useJobVersions(historyJobId || undefined);
  const { validate, isValidating, result: aiResult, clear: clearAiResult } = useValidateJobDescription();
  const { data: testsData } = useJobsWithTests();
  const { data: defBenefits } = useDefaultJobAttributes("benefit");
  const { data: defResponsibilities } = useDefaultJobAttributes("responsibility");
  const { data: defRequirements } = useDefaultJobAttributes("requirement");
  const benefitOptions = (defBenefits ?? []).map(d => d.label);
  const responsibilityOptions = (defResponsibilities ?? []).map(d => d.label);
  const requirementOptions = (defRequirements ?? []).map(d => d.label);

  // Mapa label -> id por kind, para excluir item da lista padrão.
  const labelToId: Record<DefaultJobAttributeKind, Record<string, string>> = {
    benefit: Object.fromEntries((defBenefits ?? []).map(d => [d.label, d.id])),
    responsibility: Object.fromEntries((defResponsibilities ?? []).map(d => [d.label, d.id])),
    requirement: Object.fromEntries((defRequirements ?? []).map(d => [d.label, d.id])),
  };
  const KIND_LABEL_PT: Record<DefaultJobAttributeKind, string> = {
    benefit: "benefícios",
    responsibility: "responsabilidades",
    requirement: "requisitos",
  };
  const KIND_TO_FORM_KEY: Record<DefaultJobAttributeKind, "benefits" | "responsibilities" | "requirements"> = {
    benefit: "benefits",
    responsibility: "responsibilities",
    requirement: "requirements",
  };
  const { toggleActive: toggleDefaultActive, addItem: addDefaultItem } = useDefaultJobAttributesMutations();
  const [pendingDeleteDefault, setPendingDeleteDefault] = useState<{ kind: DefaultJobAttributeKind; id: string; label: string } | null>(null);

  // Discovery Traits (Características que combinam com o cargo)
  const { data: discoveryTraits } = useDiscoveryTraits(true);
  const { addItem: addTraitItem, toggleActive: toggleTraitActive } = useDiscoveryTraitsMutations();
  const [customTrait, setCustomTrait] = useState("");
  const [pendingDeleteTrait, setPendingDeleteTrait] = useState<{ id: string; label: string; storedId: string } | null>(null);
  const traitStoredId = (t: { id: string; legacy_id: string | null }) => t.legacy_id || t.id;

  const requestDeleteTrait = (storedId: string, label: string) => {
    if (!canManage) {
      toast.error("Apenas Admin pode remover características.");
      return;
    }
    const row = (discoveryTraits ?? []).find((r) => traitStoredId(r) === storedId);
    if (!row) {
      toast.error("Característica não encontrada.");
      return;
    }
    setPendingDeleteTrait({ id: row.id, label, storedId });
  };

  const confirmDeleteTrait = async () => {
    if (!pendingDeleteTrait) return;
    try {
      await toggleTraitActive.mutateAsync({ id: pendingDeleteTrait.id, is_active: false, reason: "Removido via card de cargo" });
      setForm((prev) => ({ ...prev, discovery_traits: prev.discovery_traits.filter((x) => x !== pendingDeleteTrait.storedId) }));
      toast.success(`"${pendingDeleteTrait.label}" removido das características.`);
      setPendingDeleteTrait(null);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao remover.");
    }
  };

  const addCustomTrait = async () => {
    const t = customTrait.trim();
    if (!t) return;
    const existing = (discoveryTraits ?? []).find((r) => r.label.toLowerCase() === t.toLowerCase());
    if (existing) {
      const sid = traitStoredId(existing);
      setForm((prev) => prev.discovery_traits.includes(sid) ? prev : { ...prev, discovery_traits: [...prev.discovery_traits, sid] });
      toast.info("Característica já existe — apenas selecionada.");
      setCustomTrait("");
      return;
    }
    if (!canManage) {
      toast.error("Apenas Admin pode adicionar novas características.");
      return;
    }
    try {
      const created = await addTraitItem.mutateAsync({ label: t });
      const sid = created.legacy_id || created.id;
      setForm((prev) => prev.discovery_traits.includes(sid) ? prev : { ...prev, discovery_traits: [...prev.discovery_traits, sid] });
      toast.success(`"${t}" adicionada às características.`);
      setCustomTrait("");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível salvar a característica.");
    }
  };

  const requestDeleteDefault = (kind: DefaultJobAttributeKind, label: string) => {
    const id = labelToId[kind][label];
    if (!id) {
      toast.error("Item personalizado — basta desmarcar para remover.");
      return;
    }
    if (!canManage) {
      toast.error("Apenas Admin pode remover itens das sugestões.");
      return;
    }
    setPendingDeleteDefault({ kind, id, label });
  };

  const confirmDeleteDefault = async () => {
    if (!pendingDeleteDefault) return;
    try {
      await toggleDefaultActive.mutateAsync({
        id: pendingDeleteDefault.id,
        is_active: false,
        reason: "Removido via card de cargo",
      });
      // Também remove do form atual se estiver selecionado.
      const formKey = KIND_TO_FORM_KEY[pendingDeleteDefault.kind];
      setForm(prev => ({ ...prev, [formKey]: prev[formKey].filter(x => x !== pendingDeleteDefault.label) }));
      toast.success(`"${pendingDeleteDefault.label}" removido das sugestões.`);
      setPendingDeleteDefault(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover.");
    }
  };

  const toggleListItem = (key: "benefits" | "responsibilities" | "requirements", item: string) => {
    setForm(prev => ({
      ...prev,
      [key]: prev[key].includes(item) ? prev[key].filter(x => x !== item) : [...prev[key], item],
    }));
  };
  const FORM_KEY_TO_KIND: Record<"benefits" | "responsibilities" | "requirements", DefaultJobAttributeKind> = {
    benefits: "benefit",
    responsibilities: "responsibility",
    requirements: "requirement",
  };
  const addCustomItem = async (key: "benefits" | "responsibilities" | "requirements", value: string, reset: () => void) => {
    const t = value.trim();
    if (!t) return;
    const kind = FORM_KEY_TO_KIND[key];
    // Detecta duplicidade case-insensitive na lista padrão atual
    const existingLabel = Object.keys(labelToId[kind]).find(l => l.toLowerCase() === t.toLowerCase());
    const finalLabel = existingLabel ?? t;

    if (canManage && !existingLabel) {
      try {
        await addDefaultItem.mutateAsync({ kind, label: t });
        toast.success(`"${t}" adicionado às sugestões padrão.`);
      } catch (e: any) {
        toast.error(e?.message || "Não foi possível salvar como sugestão. Item adicionado apenas a este Cargo.");
      }
    } else if (existingLabel) {
      toast.info("Este item já existe nas sugestões — apenas selecionado.");
    }

    setForm(prev => prev[key].includes(finalLabel) ? prev : { ...prev, [key]: [...prev[key], finalLabel] });
    reset();
  };

  const requireJustification = jobsConfig?.find(s => s.key === "require_version_justification")?.value === true || jobsConfig?.find(s => s.key === "require_version_justification")?.value === "true";
  const aiValidationEnabled = jobsConfig?.find(s => s.key === "ai_job_validation_enabled")?.value === true || jobsConfig?.find(s => s.key === "ai_job_validation_enabled")?.value === "true";

  const filteredJobs = jobs?.filter(job =>
    job.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openCreate = () => {
    setEditingJob(null);
    setForm({ title: "", description: "", requires_ai_interview: false, requires_human_interview: false, allows_career_plan: false, category: "unidade", code: "", min_score: 0, requires_documents: false, sede_only: false, is_active: true, benefits: [], responsibilities: [], requirements: [], discovery_invite: "", discovery_traits: [], discovery_highlights: [] });
    setChangeReason("");
    setTitleError(false);
    clearAiResult();
    setDialogOpen(true);
  };

  const openEdit = (job: any) => {
    setEditingJob(job);
    setForm({
      title: job.title,
      description: job.description || "",
      requires_ai_interview: job.requires_ai_interview,
      requires_human_interview: job.requires_human_interview,
      allows_career_plan: job.allows_career_plan,
      category: (job as any).category || "unidade",
      code: (job as any).code || "",
      min_score: (job as any).min_score || 0,
      requires_documents: (job as any).requires_documents || false,
      sede_only: (job as any).sede_only || false,
      is_active: job.is_active ?? true,
      benefits: Array.isArray((job as any).benefits) ? (job as any).benefits : [],
      responsibilities: Array.isArray((job as any).responsibilities) ? (job as any).responsibilities : [],
      requirements: Array.isArray((job as any).requirements) ? (job as any).requirements : [],
      discovery_invite: (job as any).discovery_invite || "",
      discovery_traits: Array.isArray((job as any).discovery_traits) ? (job as any).discovery_traits.filter((t: any) => typeof t === "string") : [],
      discovery_highlights: Array.isArray((job as any).discovery_highlights) ? (job as any).discovery_highlights.filter((h: any) => typeof h === "string") : [],
    });
    setChangeReason("");
    setTitleError(false);
    setDialogOpen(true);
  };

  const [scoreError, setScoreError] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim()) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    // Validate min_score range
    if (form.min_score < 0 || form.min_score > 100) {
      setScoreError(true);
      toast.error("Score mínimo deve estar entre 0 e 100");
      return;
    }
    setScoreError(false);
    if (editingJob && requireJustification && !changeReason.trim()) {
      toast.error("Justificativa obrigatória para edição");
      return;
    }
    try {
      const saveData = { ...form, min_score: Math.round(Math.min(100, Math.max(0, form.min_score))) };
      if (editingJob) {
        await updateJob.mutateAsync({ id: editingJob.id, ...saveData, changeReason });
        toast.success("Cargo atualizado (nova versão criada)");
      } else {
        // Remove code from form — it will be auto-generated
        const { code: _ignored, ...createData } = saveData;
        await createJob.mutateAsync(createData);
        toast.success("Cargo criado");
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleToggleActive = (job: any) => {
    if (!canManage) { toast.error("Sem permissão"); return; }
    if (job.is_active) {
      setDeactivateJob(job);
    } else {
      confirmToggle(job);
    }
  };

  const confirmToggle = async (job: any) => {
    try {
      await updateJob.mutateAsync({
        id: job.id,
        is_active: !job.is_active,
        changeReason: job.is_active ? "Cargo desativado" : "Cargo reativado",
      });
      toast.success(job.is_active ? "Cargo desativado" : "Cargo ativado");
    } catch (e: any) {
      toast.error(e.message || "Erro ao alterar status do cargo");
    }
    setDeactivateJob(null);
  };

  const getUnitCount = (job: any) => {
    if (!job) return 0;
    return (job as any).unit_jobs?.[0]?.count ?? 0;
  };

  const getVersionCount = (job: any) => {
    if (!job) return 0;
    return (job as any).job_versions?.[0]?.count ?? 0;
  };

  const handleDelete = async (job: any) => {
    setDeleteTarget(job);
    setDeleteBlocked(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteJob.mutateAsync(deleteTarget.id);
      toast.success("Cargo excluído com sucesso");
      setDeleteTarget(null);
    } catch (e: any) {
      if (e.message?.startsWith("BLOCKED:")) {
        setDeleteBlocked(e.message.replace("BLOCKED:", ""));
      } else {
        toast.error(e.message);
        setDeleteTarget(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Responsive Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-foreground">Gestão de Cargos</h2>
          <PageHelp />
        </div>
        <div className="flex flex-col items-end gap-2">
          {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="whitespace-nowrap" onClick={openCreate}><Plus className="h-4 w-4 mr-2 shrink-0" />Novo Cargo</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingJob ? "Editar Cargo" : "Novo Cargo"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {editingJob?.title && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Cargo: </span>
                    <span className="font-medium text-foreground uppercase">{editingJob.title}</span>
                  </div>
                )}
                {editingJob && (
                  <div className="flex items-center gap-2">
                    <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                    <Label className="text-sm font-medium">Ativo</Label>
                  </div>
                )}
                {/* Bloco 1 — Informações básicas */}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Informações básicas</h3>
                  <div>
                    <Label>Título <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.title}
                      onChange={(e) => { setForm({ ...form, title: e.target.value }); setTitleError(false); }}
                      placeholder="Ex: Auxiliar Administrativo"
                      className={titleError ? "border-destructive" : ""}
                    />
                    {titleError && <p className="text-xs text-destructive mt-1">Título obrigatório</p>}
                  </div>
                  <div>
                    <Label>Descrição</Label>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Descreva as responsabilidades, requisitos, formação mínima, faixa salarial e carga horária do cargo..."
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Inclua requisitos, formação, experiência, faixa salarial e carga horária.
                    </p>
                  </div>
                  {editingJob && (
                    <div>
                      <Label>Código</Label>
                      <Input value={form.code} disabled className="bg-muted cursor-not-allowed" />
                      <p className="text-xs text-muted-foreground mt-1">Gerado automaticamente</p>
                    </div>
                  )}
                </div>

                {/* Bloco 2 — Configurações institucionais */}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Configurações institucionais</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <Label>Categoria</Label>
                      <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unidade">Unidade</SelectItem>
                          <SelectItem value="franqueadora">Franqueadora</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <Label>Visibilidade do cargo</Label>
                      <Select value={form.sede_only ? "sede" : "franquias"} onValueChange={(v) => setForm({ ...form, sede_only: v === "sede" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="franquias">Sede e franquias</SelectItem>
                          <SelectItem value="sede">Somente Sede</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1 leading-snug">
                        Somente Sede oculta o cargo no catálogo dos franqueados. Vagas já ativadas continuam inalteradas.
                      </p>
                    </div>
                    <div className="min-w-0">
                      <Label>Score Mínimo (0–100)</Label>
                      <Input
                        type="number"
                        value={form.min_score === 0 ? "" : form.min_score}
                        placeholder="0"
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            setForm({ ...form, min_score: 0 });
                            setScoreError(false);
                            return;
                          }
                          const val = Number(raw);
                          setForm({ ...form, min_score: val });
                          setScoreError(val < 0 || val > 100);
                        }}
                        min={0}
                        max={100}
                        className={scoreError ? "border-destructive" : ""}
                      />
                      {scoreError && <p className="text-xs text-destructive mt-1">Valor deve estar entre 0 e 100</p>}
                    </div>
                    <div className="flex items-end min-w-0">
                      <label className="flex items-center gap-2 text-sm pb-2">
                        <Switch checked={form.requires_documents} onCheckedChange={(v) => setForm({ ...form, requires_documents: v })} />
                        Exige documentos
                      </label>
                    </div>
                    <div className="flex items-end min-w-0">
                      <label className="flex items-center gap-2 text-sm pb-2">
                        <Switch checked={form.allows_career_plan} onCheckedChange={(v) => setForm({ ...form, allows_career_plan: v })} />
                        Permite plano de carreira
                      </label>
                    </div>
                  </div>
                </div>

                {/* Bloco 3 — Processo seletivo */}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Processo seletivo</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={form.requires_ai_interview} onCheckedChange={(v) => setForm({ ...form, requires_ai_interview: v })} />
                      Requer entrevista IA
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={form.requires_human_interview} onCheckedChange={(v) => setForm({ ...form, requires_human_interview: v })} />
                      Requer entrevista humana
                    </label>
                  </div>
                </div>

                {/* Seção Benefícios */}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Benefícios</h3>
                      <p className="text-[11px] text-muted-foreground">Itens herdados pelas vagas das unidades.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {benefitOptions.map((b) => (
                      <div key={b} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer min-w-0 flex-1">
                          <Checkbox checked={form.benefits.includes(b)} onCheckedChange={() => toggleListItem("benefits", b)} />
                          <span className="truncate">{b}</span>
                        </label>
                        {canManage && labelToId.benefit[b] && (
                          <button
                            type="button"
                            aria-label={`Remover ${b} das sugestões`}
                            title="Remover das sugestões"
                            onClick={() => requestDeleteDefault("benefit", b)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Input placeholder="Outro benefício..." value={customBenefit} onChange={(e) => setCustomBenefit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomItem("benefits", customBenefit, () => setCustomBenefit("")); } }} />
                    <Button variant="outline" size="sm" type="button" onClick={() => addCustomItem("benefits", customBenefit, () => setCustomBenefit(""))}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                  </div>
                  {form.benefits.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {form.benefits.map((b) => (
                        <Badge key={b} variant="secondary" className="text-xs cursor-pointer" onClick={() => toggleListItem("benefits", b)}>{b} ×</Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Seção Responsabilidades */}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Responsabilidades</h3>
                      <p className="text-[11px] text-muted-foreground">Atividades esperadas para o cargo.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {responsibilityOptions.map((r) => (
                      <div key={r} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer min-w-0 flex-1">
                          <Checkbox checked={form.responsibilities.includes(r)} onCheckedChange={() => toggleListItem("responsibilities", r)} />
                          <span className="truncate">{r}</span>
                        </label>
                        {canManage && labelToId.responsibility[r] && (
                          <button
                            type="button"
                            aria-label={`Remover ${r} das sugestões`}
                            title="Remover das sugestões"
                            onClick={() => requestDeleteDefault("responsibility", r)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Input placeholder="Outra responsabilidade..." value={customResponsibility} onChange={(e) => setCustomResponsibility(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomItem("responsibilities", customResponsibility, () => setCustomResponsibility("")); } }} />
                    <Button variant="outline" size="sm" type="button" onClick={() => addCustomItem("responsibilities", customResponsibility, () => setCustomResponsibility(""))}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                  </div>
                  {form.responsibilities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {form.responsibilities.map((r) => (
                        <Badge key={r} variant="secondary" className="text-xs cursor-pointer" onClick={() => toggleListItem("responsibilities", r)}>{r} ×</Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Seção Requisitos */}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Requisitos</h3>
                      <p className="text-[11px] text-muted-foreground">Pré-requisitos para assumir o cargo.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {requirementOptions.map((r) => (
                      <div key={r} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer min-w-0 flex-1">
                          <Checkbox checked={form.requirements.includes(r)} onCheckedChange={() => toggleListItem("requirements", r)} />
                          <span className="truncate">{r}</span>
                        </label>
                        {canManage && labelToId.requirement[r] && (
                          <button
                            type="button"
                            aria-label={`Remover ${r} das sugestões`}
                            title="Remover das sugestões"
                            onClick={() => requestDeleteDefault("requirement", r)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Input placeholder="Outro requisito..." value={customRequirement} onChange={(e) => setCustomRequirement(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomItem("requirements", customRequirement, () => setCustomRequirement("")); } }} />
                    <Button variant="outline" size="sm" type="button" onClick={() => addCustomItem("requirements", customRequirement, () => setCustomRequirement(""))}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                  </div>
                  {form.requirements.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {form.requirements.map((r) => (
                        <Badge key={r} variant="secondary" className="text-xs cursor-pointer" onClick={() => toggleListItem("requirements", r)}>{r} ×</Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bloco — Descoberta do candidato */}
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Descoberta do candidato</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Conteúdo usado na conversa em <code>/oportunidades</code> para sugerir esse cargo às candidatas.
                    </p>
                  </div>

                  <div>
                    <Label>Frase-convite</Label>
                    <Input
                      value={form.discovery_invite}
                      onChange={(e) => setForm({ ...form, discovery_invite: e.target.value })}
                      placeholder="Ex.: Quero entender mais sobre o que faz um vendedor na Recruta"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Aparece na bolha de "saber mais sobre esse cargo".
                    </p>
                  </div>

                  <div>
                    <Label>Características que combinam com esse cargo</Label>
                    <p className="text-[11px] text-muted-foreground mb-2">
                      Marque o que uma pessoa que se daria bem nesse cargo costuma gostar/ter facilidade.
                    </p>
                    <div className="space-y-2">
                      {(discoveryTraits ?? []).map((t) => {
                        const sid = traitStoredId(t);
                        const checked = form.discovery_traits.includes(sid);
                        return (
                          <div key={t.id} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                            <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => {
                                  setForm((prev) => ({
                                    ...prev,
                                    discovery_traits: checked
                                      ? prev.discovery_traits.filter((x) => x !== sid)
                                      : [...prev.discovery_traits, sid],
                                  }));
                                }}
                              />
                              <span className="leading-snug text-sm">{t.label}</span>
                            </label>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => requestDeleteTrait(sid, t.label)}
                                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                                title="Remover das sugestões"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Input
                        placeholder="Adicionar característica…"
                        value={customTrait}
                        onChange={(e) => setCustomTrait(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTrait(); } }}
                      />
                      <Button type="button" variant="outline" onClick={addCustomTrait}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                    </div>
                    {form.discovery_traits.length === 0 && (
                      <p className="text-[11px] text-amber-600 mt-2">
                        Sem características marcadas, o sistema usa um fallback automático baseado no título.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label>Bullets do "saber mais" (opcional)</Label>
                    <Textarea
                      value={form.discovery_highlights.join("\n")}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          discovery_highlights: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder={"Um por linha. Ex.:\nO que faz: atende clientes e organiza a loja\nMetas: bater meta semanal de vendas\nPúblico: famílias com crianças\nRitmo: dia movimentado, sempre em pé"}
                      className="min-h-[100px]"
                    />
                  </div>
                </div>

                {editingJob && (
                  <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-2">
                    <Label>
                      Justificativa da alteração
                      {requireJustification && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    <Textarea
                      value={changeReason}
                      onChange={(e) => setChangeReason(e.target.value)}
                      placeholder="Descreva o motivo da alteração..."
                    />
                  </div>
                )}

                {aiValidationEnabled && (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => validate(form.title, form.description)}
                      disabled={isValidating || !form.title.trim()}
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      {isValidating ? "Validando com IA..." : "Validar com IA"}
                    </Button>
                    {aiResult && aiResult.enabled && (
                      <div className={`rounded-lg border p-3 text-sm space-y-2 ${aiResult.verdict === "aprovado" ? "border-green-500/30 bg-green-500/5" : "border-yellow-500/30 bg-yellow-500/5"}`}>
                        <div className="flex items-center gap-2 font-medium">
                          {aiResult.verdict === "aprovado" ? (
                            <><CheckCircle2 className="h-4 w-4 text-green-600" /> Aprovado — Score {aiResult.score}/100</>
                          ) : (
                            <><AlertTriangle className="h-4 w-4 text-yellow-600" /> Revisar — Score {aiResult.score}/100</>
                          )}
                        </div>
                        {aiResult.issues && aiResult.issues.length > 0 && (
                          <div>
                            <p className="font-medium text-xs text-muted-foreground">Problemas:</p>
                            <ul className="list-disc pl-4 text-xs">{aiResult.issues.map((i, idx) => <li key={idx}>{i}</li>)}</ul>
                          </div>
                        )}
                        {aiResult.suggestions && aiResult.suggestions.length > 0 && (
                          <div>
                            <p className="font-medium text-xs text-muted-foreground">Sugestões:</p>
                            <ul className="list-disc pl-4 text-xs">{aiResult.suggestions.map((s, idx) => <li key={idx}>{s}</li>)}</ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <Button
                  onClick={handleSave}
                  className="w-full"
                  disabled={
                    createJob.isPending ||
                    updateJob.isPending ||
                    (editingJob && requireJustification && !changeReason.trim())
                  }
                >
                  {editingJob ? "Salvar" : "Criar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          )}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Mostrar inativos
          </label>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar cargo..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : !filteredJobs?.length ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">
            {searchQuery ? "Nenhum cargo encontrado" : "Nenhum cargo cadastrado"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {searchQuery ? "Tente outro termo de busca." : "Comece criando seu primeiro cargo institucional."}
          </p>
          {!searchQuery && canManage && (
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Criar primeiro cargo</Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredJobs.map((job) => (
            <Card key={job.id} className={!job.is_active ? "opacity-60" : ""}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{job.title}</CardTitle>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/vagas?newJob=${job.id}`)} title="Abrir vaga para este cargo">
                    <MapPin className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setHistoryJobId(job.id)} title="Histórico de versões">
                    <History className="h-4 w-4" />
                  </Button>
                  {canManage && (
                    <Button variant="ghost" size="icon" onClick={() => openEdit(job)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canPersonalizeNow && (
                    <Button variant="ghost" size="icon" onClick={() => setOverrideTarget(job)} title="Personalizar para minhas unidades (somente marcar/desmarcar Benefícios, Responsabilidades e Requisitos)">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canManage && (
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(job)} title="Excluir cargo" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {job.description && <p className="text-sm text-muted-foreground line-clamp-3">{job.description}</p>}

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5">
                  {job.requires_ai_interview && <Badge variant="secondary" className="text-[10px]">IA</Badge>}
                  {job.requires_human_interview && <Badge variant="secondary" className="text-[10px]">Humano</Badge>}
                  {job.allows_career_plan && <Badge variant="secondary" className="text-[10px]">Carreira</Badge>}
                  {(job as any).requires_documents && <Badge variant="secondary" className="text-[10px]">Docs</Badge>}
                  {(job as any).sede_only && (
                    <Badge variant="default" className="text-[10px] gap-1">
                      <Building2 className="h-3 w-3" />
                      Sede
                    </Badge>
                  )}
                  {(job as any).code && <Badge variant="outline" className="text-[10px]">{(job as any).code}</Badge>}
                  {(job as any).category === "franqueadora" && <Badge variant="default" className="text-[10px]">Corp.</Badge>}

                  <Badge variant="outline" className="text-[10px]">
                    {job.job_pipelines?.length || 0} pipeline(s)
                  </Badge>
                  {!jobHasSpecificTest(job.id, testsData) && !testsData?.hasGlobalTemplate && (
                    <Link to="/admin/testes">
                      <Badge variant="destructive" className="text-[10px] gap-1 cursor-pointer">
                        <AlertTriangle className="h-3 w-3" />
                        Sem teste — invisível para candidatos
                      </Badge>
                    </Link>
                  )}
                  {!jobHasSpecificTest(job.id, testsData) && testsData?.hasGlobalTemplate && (
                    <Link to="/admin/testes">
                      <Badge className="text-[10px] gap-1 bg-amber-500/15 text-amber-700 border-amber-300 cursor-pointer hover:bg-amber-500/20">
                        <AlertTriangle className="h-3 w-3" />
                        Sem teste próprio — usando template global
                      </Badge>
                    </Link>
                  )}
                </div>

                {/* Metadata row */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1" title="Unidades vinculadas">
                    <Building2 className="h-3 w-3" /> {getUnitCount(job)} unidade(s)
                  </span>
                  <span className="flex items-center gap-1" title="Versão">
                    <History className="h-3 w-3" /> v{getVersionCount(job)}
                  </span>
                  <span className="flex items-center gap-1" title="Data de criação">
                    <CalendarDays className="h-3 w-3" /> {format(new Date(job.created_at), "dd/MM/yyyy")}
                  </span>
                </div>

                {/* Active toggle */}
                <div className="flex items-center justify-between pt-1 border-t border-border">
                  <Badge variant={job.is_active ? "default" : "secondary"}>
                    {job.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                  {canManage && <Switch checked={job.is_active} onCheckedChange={() => handleToggleActive(job)} />}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Deactivation Confirmation */}
      <AlertDialog open={!!deactivateJob} onOpenChange={(open) => !open && setDeactivateJob(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar cargo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja desativar o cargo <strong>"{deactivateJob?.title}"</strong>?
              {getUnitCount(deactivateJob) > 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  Atenção: este cargo está vinculado a {getUnitCount(deactivateJob)} unidade(s).
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivateJob && confirmToggle(deactivateJob)}>
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation — Double Confirm */}
      {deleteBlocked ? (
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteBlocked(null); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Exclusão bloqueada</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="text-destructive">{deleteBlocked}</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <DoubleConfirmDialog
          open={!!deleteTarget && !deleteBlocked}
          onOpenChange={(open) => { if (!open) { setDeleteTarget(null); } }}
          title="Excluir cargo"
          description={`Tem certeza que deseja excluir o cargo "${deleteTarget?.title}"? Esta ação é irreversível.`}
          onConfirm={confirmDelete}
        />
      )}

      {/* Version History Sheet */}
      <Sheet open={!!historyJobId} onOpenChange={(open) => !open && setHistoryJobId(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico de Versões
            </SheetTitle>
          </SheetHeader>

          {/* Diff Viewer */}
          {diffVersions && (
            <div className="mt-4 mb-4 border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <GitCompare className="h-4 w-4" />
                  Comparação: v{diffVersions[0].version_number} → v{diffVersions[1].version_number}
                </h4>
                <Button variant="ghost" size="sm" onClick={() => setDiffVersions(null)}>Fechar</Button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="font-semibold text-muted-foreground">v{diffVersions[0].version_number} (anterior)</div>
                <div className="font-semibold text-muted-foreground">v{diffVersions[1].version_number} (posterior)</div>
                {["title", "description", "requires_ai_interview", "requires_human_interview", "allows_career_plan", "is_active", "category", "code", "min_score", "requires_documents"].map((field) => {
                  const oldVal = String(diffVersions[0].snapshot?.[field] ?? "—");
                  const newVal = String(diffVersions[1].snapshot?.[field] ?? "—");
                  const changed = oldVal !== newVal;
                  return (
                    <div key={field} className="contents">
                      <div className={`p-1.5 rounded ${changed ? "bg-destructive/10 text-destructive" : ""}`}>
                        <strong className="capitalize">{field.replace(/_/g, " ")}:</strong> {oldVal}
                      </div>
                      <div className={`p-1.5 rounded ${changed ? "bg-green-500/10 text-green-700 dark:text-green-400" : ""}`}>
                        <strong className="capitalize">{field.replace(/_/g, " ")}:</strong> {newVal}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-6 space-y-2">
            {versionsLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : !versions?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum histórico de versões encontrado.</p>
            ) : (
              <>
                {versions.length >= 2 && (
                  <div className="flex items-center gap-2 mb-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDiffVersions([versions[versions.length - 1], versions[0]])}
                      className="text-xs"
                    >
                      <GitCompare className="h-3 w-3 mr-1" />
                      Comparar primeira ↔ última
                    </Button>
                  </div>
                )}
                <Accordion type="single" collapsible className="w-full">
                  {versions.map((v: any, idx: number) => (
                    <AccordionItem key={v.id} value={v.id}>
                      <AccordionTrigger className="text-sm">
                        <div className="flex items-center gap-2 text-left">
                          <Badge variant="outline" className="text-[10px] shrink-0">v{v.version_number}</Badge>
                          <span className="truncate">
                            {v.change_reason || "Sem justificativa"}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0 ml-auto mr-2">
                            {format(new Date(v.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm bg-muted/50 rounded-md p-3">
                          <div><strong>Título:</strong> {v.snapshot?.title}</div>
                          <div><strong>Descrição:</strong> {v.snapshot?.description || "—"}</div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={v.snapshot?.requires_ai_interview ? "default" : "secondary"} className="text-[10px]">
                              IA: {v.snapshot?.requires_ai_interview ? "Sim" : "Não"}
                            </Badge>
                            <Badge variant={v.snapshot?.requires_human_interview ? "default" : "secondary"} className="text-[10px]">
                              Humana: {v.snapshot?.requires_human_interview ? "Sim" : "Não"}
                            </Badge>
                            <Badge variant={v.snapshot?.allows_career_plan ? "default" : "secondary"} className="text-[10px]">
                              Carreira: {v.snapshot?.allows_career_plan ? "Sim" : "Não"}
                            </Badge>
                            <Badge variant={v.snapshot?.is_active ? "default" : "secondary"} className="text-[10px]">
                              {v.snapshot?.is_active ? "Ativo" : "Inativo"}
                            </Badge>
                          </div>
                          {idx < versions.length - 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs mt-2"
                              onClick={() => setDiffVersions([versions[idx + 1], v])}
                            >
                              <GitCompare className="h-3 w-3 mr-1" />
                              Comparar com v{versions[idx + 1].version_number}
                            </Button>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <DoubleConfirmDialog
        open={!!pendingDeleteDefault}
        onOpenChange={(o) => { if (!o) setPendingDeleteDefault(null); }}
        title="Remover sugestão padrão?"
        description={pendingDeleteDefault ? `"${pendingDeleteDefault.label}" será ocultado das sugestões de ${KIND_LABEL_PT[pendingDeleteDefault.kind]} em todos os Cargos. Esta ação é registrada para auditoria.` : ""}
        confirmLabel="Remover"
        loading={toggleDefaultActive.isPending}
        onConfirm={confirmDeleteDefault}
      />

      <DoubleConfirmDialog
        open={!!pendingDeleteTrait}
        onOpenChange={(o) => { if (!o) setPendingDeleteTrait(null); }}
        title="Remover característica?"
        description={pendingDeleteTrait ? `"${pendingDeleteTrait.label}" será ocultada das características em todos os Cargos. Esta ação é registrada para auditoria.` : ""}
        confirmLabel="Remover"
        loading={toggleTraitActive.isPending}
        onConfirm={confirmDeleteTrait}
      />

      <UnitOverrideForJobDialog
        open={!!overrideTarget}
        onOpenChange={(o) => { if (!o) setOverrideTarget(null); }}
        job={overrideTarget}
        allowedUnitIds={myAllowedUnitIds}
      />
    </div>
  );
}
