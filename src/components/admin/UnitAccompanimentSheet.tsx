import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { MapPin, Store, Loader2, Trash2, Plus, CheckCircle2, Circle, Activity } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ymdToLocalDate, dateToLocalYMD } from "@/lib/dateUtils";
import {
  useUpsertUnitImplementation,
  type FranchiseeRow,
  type ImplementationStatus,
  type HealthLevel,
  type UnitChecklist,
  type UnitMilestones,
} from "@/hooks/useFranchiseePanel";
import { useUnitTimelineNotes, useUnitTimelineEvents } from "@/hooks/useUnitAccompaniment";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const STATUS_META: Record<ImplementationStatus, { label: string; variant: BadgeVariant; cls?: string }> = {
  nao_iniciada: { label: "Não iniciada", variant: "outline" },
  agendado: { label: "Agendado", variant: "secondary" },
  em_andamento: { label: "Em andamento", variant: "secondary", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  concluido: { label: "Concluído", variant: "secondary", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
};

export const HEALTH_META: Record<HealthLevel, { label: string; cls: string; dot: string }> = {
  saudavel: { label: "🟢 Saudável", cls: "bg-emerald-100 text-emerald-800 border-emerald-300", dot: "bg-emerald-500" },
  atencao: { label: "🟡 Atenção", cls: "bg-amber-100 text-amber-800 border-amber-300", dot: "bg-amber-500" },
  critico: { label: "🔴 Crítico", cls: "bg-red-100 text-red-800 border-red-300", dot: "bg-red-500" },
};

const ONBOARDING_ITEMS: { key: keyof UnitChecklist["onboarding"]; label: string }[] = [
  { key: "apresentacao", label: "Apresentação realizada" },
  { key: "manual_enviado", label: "Manual enviado" },
  { key: "acesso_liberado", label: "Acesso liberado" },
  { key: "login_realizado", label: "Login realizado" },
  { key: "primeira_vaga", label: "Primeira vaga publicada" },
];
const DIVULGACAO_ITEMS: { key: keyof UnitChecklist["divulgacao"]; label: string }[] = [
  { key: "instagram", label: "Publicou vaga no Instagram" },
  { key: "linkedin", label: "Compartilhou no LinkedIn" },
  { key: "whatsapp", label: "Compartilhou em grupos de WhatsApp" },
  { key: "facebook", label: "Compartilhou no Facebook" },
];
const MILESTONE_ITEMS: { key: keyof UnitMilestones; label: string }[] = [
  { key: "primeira_reuniao", label: "Primeira reunião realizada" },
  { key: "onboarding_apresentado", label: "Onboarding apresentado" },
  { key: "loja_inaugurada", label: "Loja inaugurada" },
];

const MILESTONE_LABEL: Record<string, string> = Object.fromEntries(MILESTONE_ITEMS.map((m) => [m.key, m.label]));

/** YYYY-MM-DD → Date local; ISO datetime → Date. */
function toDate(s: string): Date {
  return s.length === 10 ? ymdToLocalDate(s) ?? new Date(s) : parseISO(s);
}
function fmtDay(s: string) {
  try {
    return format(toDate(s), "dd/MM/yyyy");
  } catch {
    return "—";
  }
}

interface TimelineItem {
  id: string;
  date: string;
  label: string;
  kind: "auto" | "milestone" | "note";
}

interface Props {
  row: FranchiseeRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admins: { id: string; name: string }[];
}

export function UnitAccompanimentSheet({ row, open, onOpenChange, admins }: Props) {
  const upsert = useUpsertUnitImplementation();
  const { notes, isLoading: notesLoading, addNote, deleteNote } = useUnitTimelineNotes(open ? row?.unitId ?? null : null);
  const { data: autoEvents, isLoading: eventsLoading } = useUnitTimelineEvents(open ? row?.unitId ?? null : null);

  // Estado local (semeado ao trocar de unidade — não é reescrito por refetch em background)
  const [checklist, setChecklist] = useState<UnitChecklist | null>(null);
  const [milestones, setMilestones] = useState<UnitMilestones | null>(null);
  const [observacoes, setObservacoes] = useState("");
  const [status, setStatus] = useState<ImplementationStatus>("nao_iniciada");
  const [responsavelId, setResponsavelId] = useState<string>("none");
  const [nextAction, setNextAction] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newNoteDate, setNewNoteDate] = useState(() => dateToLocalYMD(new Date()));

  const unitId = row?.unitId;
  useEffect(() => {
    if (!row) return;
    setChecklist(row.checklist);
    setMilestones(row.milestones);
    setObservacoes(row.observacoes ?? "");
    setStatus(row.status);
    setResponsavelId(row.responsavelId ?? "none");
    setNextAction(row.nextAction ?? "");
    setNextActionDate(row.nextActionDate ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const adminNameById = useMemo(() => new Map(admins.map((a) => [a.id, a.name])), [admins]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    (autoEvents || []).forEach((e) => items.push({ id: `auto-${e.key}`, date: e.date, label: e.label, kind: "auto" }));
    if (milestones) {
      (Object.keys(milestones) as (keyof UnitMilestones)[]).forEach((k) => {
        const d = milestones[k];
        if (d) items.push({ id: `ms-${k}`, date: d, label: MILESTONE_LABEL[k], kind: "milestone" });
      });
    }
    notes.forEach((n) => items.push({ id: `note-${n.id}`, date: n.noteDate, label: n.note, kind: "note" }));
    return items.sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
  }, [autoEvents, milestones, notes]);

  if (!row) return null;
  const health = HEALTH_META[row.health.level];
  const st = STATUS_META[status];
  const location = [row.city, row.state].filter(Boolean).join(" / ") || "—";

  const persist = async (patch: Parameters<typeof upsert.mutateAsync>[0]) => {
    try {
      await upsert.mutateAsync(patch);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar.");
      throw e;
    }
  };

  const toggleChecklist = async (
    section: keyof UnitChecklist,
    key: string,
    value: boolean,
  ) => {
    if (!checklist || !unitId) return;
    const next: UnitChecklist = {
      ...checklist,
      [section]: { ...checklist[section], [key]: value },
    };
    setChecklist(next);
    await persist({ unitId, checklist: next }).catch(() => setChecklist(checklist));
  };

  const setMilestone = async (key: keyof UnitMilestones, ymd: string) => {
    if (!milestones || !unitId) return;
    const next: UnitMilestones = { ...milestones, [key]: ymd || null };
    setMilestones(next);
    await persist({ unitId, milestones: next }).catch(() => setMilestones(milestones));
  };

  const saveObservacoes = async () => {
    if (!unitId) return;
    await persist({ unitId, observacoes: observacoes.trim() || null });
    toast.success("Observações salvas.");
  };

  const saveAcompanhamento = async () => {
    if (!unitId) return;
    await persist({
      unitId,
      status,
      responsavelId: responsavelId === "none" ? null : responsavelId,
      nextAction: nextAction.trim() || null,
      nextActionDate: nextActionDate || null,
    });
    toast.success("Acompanhamento atualizado.");
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await addNote.mutateAsync({ note: newNote.trim(), noteDate: newNoteDate });
      setNewNote("");
      toast.success("Observação adicionada à timeline.");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao adicionar observação.");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b border-border space-y-2">
          <SheetTitle className="flex items-center gap-2 text-left">
            <Store className="h-5 w-5 text-muted-foreground shrink-0" />
            {row.unitName}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-1.5 text-left">
            <MapPin className="h-3.5 w-3.5" /> {location}
            {row.franqueadoNames.length > 0 && <span className="name-display">· {row.franqueadoNames.join(", ")}</span>}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="outline" className={health.cls}>{health.label}</Badge>
            <Badge variant={st.variant} className={st.cls}>{st.label}</Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {/* Saúde da Unidade */}
          <section className="mb-5 rounded-lg border border-border p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Saúde da Unidade
            </p>
            <ul className="space-y-1">
              {row.health.reasons.map((r, i) => (
                <li key={i} className="text-xs flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
                  {r}
                </li>
              ))}
            </ul>
          </section>

          <Tabs defaultValue="timeline">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="checklist">Checklist</TabsTrigger>
              <TabsTrigger value="obs">Observações</TabsTrigger>
              <TabsTrigger value="rh">RH</TabsTrigger>
            </TabsList>

            {/* ── Timeline ── */}
            <TabsContent value="timeline" className="space-y-4 pt-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Marcos manuais</p>
                {MILESTONE_ITEMS.map((m) => (
                  <div key={m.key} className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-normal">{m.label}</Label>
                    <MaskedDateInput
                      value={ymdToLocalDate(milestones?.[m.key] ?? "")}
                      onChange={(d) => setMilestone(m.key, dateToLocalYMD(d))}
                      format="dd/MM/yyyy"
                      placeholder="dd/mm/aaaa"
                      size="sm"
                    />
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Linha do tempo</p>
                {eventsLoading || notesLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">Nenhum evento registrado ainda.</p>
                ) : (
                  <ol className="space-y-3 border-l border-border pl-4">
                    {timeline.map((it) => (
                      <li key={it.id} className="relative">
                        <span
                          className={`absolute -left-[21px] top-0.5 h-2.5 w-2.5 rounded-full ${
                            it.kind === "note" ? "bg-blue-400" : "bg-emerald-500"
                          }`}
                        />
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">{fmtDay(it.date)}</p>
                            <p className="text-sm">{it.label}</p>
                          </div>
                          {it.kind === "note" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteNote.mutate(it.id.replace(/^note-/, ""))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Adicionar observação</p>
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Ex: Franqueado demonstrou dificuldade em divulgar as vagas."
                  className="min-h-[60px] text-sm"
                />
                <div className="flex items-center gap-2">
                  <MaskedDateInput
                    value={ymdToLocalDate(newNoteDate)}
                    onChange={(d) => setNewNoteDate(dateToLocalYMD(d))}
                    format="dd/MM/yyyy"
                    placeholder="dd/mm/aaaa"
                    size="sm"
                  />
                  <Button size="sm" onClick={handleAddNote} disabled={!newNote.trim() || addNote.isPending}>
                    {addNote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                    Adicionar
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* ── Checklist ── */}
            <TabsContent value="checklist" className="space-y-4 pt-4">
              <ChecklistSection
                title="Onboarding"
                items={ONBOARDING_ITEMS}
                values={checklist?.onboarding}
                onToggle={(k, v) => toggleChecklist("onboarding", k, v)}
              />
              <ChecklistSection
                title="Divulgação"
                items={DIVULGACAO_ITEMS}
                values={checklist?.divulgacao}
                onToggle={(k, v) => toggleChecklist("divulgacao", k, v)}
              />
            </TabsContent>

            {/* ── Observações ── */}
            <TabsContent value="obs" className="space-y-3 pt-4">
              <Label className="text-xs">Observações gerais</Label>
              <Textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Ex: Franqueado possui dificuldade para utilizar a etapa de triagem. Solicitou novo treinamento."
                className="min-h-[140px] text-sm"
              />
              <Button size="sm" onClick={saveObservacoes} disabled={upsert.isPending}>
                {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar observações
              </Button>
            </TabsContent>

            {/* ── Acompanhamento RH ── */}
            <TabsContent value="rh" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Status da implantação</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as ImplementationStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao_iniciada">Não iniciada</SelectItem>
                    <SelectItem value="agendado">Agendado</SelectItem>
                    <SelectItem value="em_andamento">Em andamento</SelectItem>
                    <SelectItem value="concluido">Concluído</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Responsável (RH)</Label>
                <Select value={responsavelId} onValueChange={setResponsavelId}>
                  <SelectTrigger><SelectValue placeholder="Não atribuído" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não atribuído</SelectItem>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Próxima ação</Label>
                <Input
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder="Ex: Auxiliar na divulgação"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data da próxima ação</Label>
                <MaskedDateInput
                  value={ymdToLocalDate(nextActionDate)}
                  onChange={(d) => setNextActionDate(dateToLocalYMD(d))}
                  format="dd/MM/yyyy"
                  placeholder="dd/mm/aaaa"
                  size="sm"
                />
              </div>
              {row.responsavelId && (
                <p className="text-xs text-muted-foreground name-display">
                  Responsável atual: {adminNameById.get(row.responsavelId) || "—"}
                </p>
              )}
              <Button size="sm" onClick={saveAcompanhamento} disabled={upsert.isPending}>
                {upsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar acompanhamento
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChecklistSection<T extends string>({
  title,
  items,
  values,
  onToggle,
}: {
  title: string;
  items: { key: T; label: string }[];
  values: Record<string, boolean> | undefined;
  onToggle: (key: T, value: boolean) => void;
}) {
  const done = items.filter((i) => values?.[i.key]).length;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold">{title}</p>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          {done === items.length ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Circle className="h-3.5 w-3.5" />
          )}
          {done}/{items.length}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((it) => {
          const checked = !!values?.[it.key];
          return (
            <li key={it.key} className="flex items-center gap-2">
              <Checkbox
                id={`chk-${title}-${it.key}`}
                checked={checked}
                onCheckedChange={(v) => onToggle(it.key, v === true)}
              />
              <Label htmlFor={`chk-${title}-${it.key}`} className="text-sm font-normal cursor-pointer">
                {it.label}
              </Label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
