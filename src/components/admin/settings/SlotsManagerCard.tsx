import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { TimeInput } from "@/components/ui/time-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Loader2, ChevronDown, MapPin, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAllSlots, useCreateSlot, useDeleteSlot, useUpdateSlot } from "@/hooks/useScheduling";
import { formatModality } from "@/lib/modalityLabel";

const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function ModalityCheckboxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const presencial = value === "presencial" || value === "ambos";
  const online = value === "online" || value === "ambos";

  const update = (next: { p: boolean; o: boolean }) => {
    if (next.p && next.o) onChange("ambos");
    else if (next.p) onChange("presencial");
    else if (next.o) onChange("online");
    else onChange("");
  };

  return (
    <div className="flex gap-6 pt-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox checked={presencial} onCheckedChange={(c) => update({ p: !!c, o: online })} />
        <span className="text-sm">Presencial</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox checked={online} onCheckedChange={(c) => update({ p: presencial, o: !!c })} />
        <span className="text-sm">Online</span>
      </label>
    </div>
  );
}

export function SlotsManagerCard() {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const scopedUnitIds = !isSuperAdmin && myUnitIds.length > 0 ? myUnitIds : undefined;

  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [newSlotOpen, setNewSlotOpen] = useState(false);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<any>(null);
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const [editSlotData, setEditSlotData] = useState({ day_of_week: "1", modality: "presencial", periods: [{ start_time: "09:00", end_time: "17:00", auto_confirm: false }] });
  const [newSlot, setNewSlot] = useState({ day_of_week: "1", modality: "presencial", periods: [{ start_time: "09:00", end_time: "12:00", auto_confirm: false }, { start_time: "13:00", end_time: "17:00", auto_confirm: false }] });

  const { data: units } = useQuery({
    queryKey: ["units_list", isSuperAdmin, myUnitIds],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").eq("is_active", true).order("name");
      if (!isSuperAdmin && myUnitIds.length > 0) {
        q = q.in("id", myUnitIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      if (data?.length === 1 && !selectedUnit) {
        setSelectedUnit(data[0].id);
      }
      return data;
    },
  });

  const { data: slots, isLoading: slotsLoading } = useAllSlots(selectedUnit || undefined, !selectedUnit ? scopedUnitIds : undefined);
  const createSlot = useCreateSlot();
  const deleteSlot = useDeleteSlot();
  const updateSlot = useUpdateSlot();

  const handleCreateSlot = async () => {
    if (!selectedUnit) { toast.error("Selecione uma unidade"); return; }
    const validPeriods = newSlot.periods.filter(p => p.start_time && p.end_time && p.start_time < p.end_time);
    if (validPeriods.length === 0) { toast.error("Adicione pelo menos um período válido"); return; }
    try {
      for (const period of validPeriods) {
        await createSlot.mutateAsync({
          unit_id: selectedUnit,
          day_of_week: parseInt(newSlot.day_of_week),
          start_time: period.start_time,
          end_time: period.end_time,
          modality: newSlot.modality,
          auto_confirm: !!period.auto_confirm,
        });
      }
      toast.success(`${validPeriods.length} período(s) criado(s)!`);
      setNewSlotOpen(false);
      setNewSlot({ day_of_week: "1", modality: "presencial", periods: [{ start_time: "09:00", end_time: "12:00", auto_confirm: false }, { start_time: "13:00", end_time: "17:00", auto_confirm: false }] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <div><CardTitle>Horários disponíveis para entrevistas</CardTitle><CardDescription>Slots semanais recorrentes para agendamento de entrevistas</CardDescription></div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="min-w-[180px]">
              <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione a unidade" /></SelectTrigger>
                <SelectContent>
                  {units?.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Dialog open={newSlotOpen} onOpenChange={setNewSlotOpen}>
              <DialogTrigger asChild><Button size="sm" disabled={!selectedUnit}><Plus className="h-4 w-4 mr-1" />Novo Horário</Button></DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Novo Horário</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div><Label>Dia da semana</Label>
                    <Select value={newSlot.day_of_week} onValueChange={v => setNewSlot(p => ({ ...p, day_of_week: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Períodos de disponibilidade</Label>
                    {newSlot.periods.map((period, idx) => (
                      <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <span className="text-xs text-muted-foreground">Início</span>
                            <TimeInput value={period.start_time} onChange={v => {
                              const periods = [...newSlot.periods];
                              periods[idx] = { ...periods[idx], start_time: v };
                              setNewSlot(p => ({ ...p, periods }));
                            }} />
                          </div>
                          <div className="flex-1">
                            <span className="text-xs text-muted-foreground">Fim</span>
                            <TimeInput value={period.end_time} onChange={v => {
                              const periods = [...newSlot.periods];
                              periods[idx] = { ...periods[idx], end_time: v };
                              setNewSlot(p => ({ ...p, periods }));
                            }} />
                          </div>
                          {newSlot.periods.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => {
                              const periods = newSlot.periods.filter((_, i) => i !== idx);
                              setNewSlot(p => ({ ...p, periods }));
                            }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          )}
                        </div>
                        <label className="flex items-start gap-2 cursor-pointer pt-1">
                          <Checkbox
                            checked={period.auto_confirm}
                            onCheckedChange={(c) => {
                              const periods = [...newSlot.periods];
                              periods[idx] = { ...periods[idx], auto_confirm: !!c };
                              setNewSlot(p => ({ ...p, periods }));
                            }}
                            className="mt-0.5"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium">Auto-confirmar agendamentos neste horário</span>
                            <p className="text-xs text-muted-foreground">O agendamento do candidato já é confirmado, sem precisar de aprovação do recrutador. Uma vez ocupado, esse dia e horário ficam indisponíveis para outros candidatos.</p>
                          </div>
                        </label>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => {
                      setNewSlot(p => ({ ...p, periods: [...p.periods, { start_time: "", end_time: "", auto_confirm: false }] }));
                    }}><Plus className="h-4 w-4 mr-1" />Adicionar período</Button>
                    <p className="text-xs text-muted-foreground">Ex: 09:00-12:00 (manhã) e 13:00-16:00 (tarde) para pausar no almoço.</p>
                  </div>

                  <div><Label>Modalidade</Label>
                    <ModalityCheckboxes value={newSlot.modality} onChange={(v) => setNewSlot(p => ({ ...p, modality: v }))} />
                  </div>

                  <Button className="w-full" onClick={handleCreateSlot} disabled={createSlot.isPending}>
                    {createSlot.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Criar {newSlot.periods.filter(p => p.start_time && p.end_time).length} período(s)
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {slotsLoading ? <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div> :
            (() => {
              const activeSlots = slots || [];
              const unitMap = units?.reduce((acc: Record<string, string>, u: any) => { acc[u.id] = u.name; return acc; }, {}) || {};
              return !activeSlots.length ? <p className="text-muted-foreground text-sm text-center py-4">Nenhum horário cadastrado{selectedUnit ? " para esta unidade" : ""}. {!selectedUnit && units && units.length > 1 ? "Selecione uma unidade acima para criar novos horários." : ""}</p> :
              (() => {
                const groups = new Map<string, { unitId: string; unitName: string; items: any[] }>();
                for (const s of activeSlots) {
                  const uid = s.unit_id || "__none__";
                  const uname = unitMap[s.unit_id] || "Sem unidade";
                  if (!groups.has(uid)) groups.set(uid, { unitId: uid, unitName: uname, items: [] });
                  groups.get(uid)!.items.push(s);
                }
                const groupList = Array.from(groups.values()).sort((a, b) =>
                  a.unitName.localeCompare(b.unitName, "pt-BR")
                );
                for (const g of groupList) {
                  g.items.sort((a, b) =>
                    (a.day_of_week - b.day_of_week) ||
                    String(a.start_time || "").localeCompare(String(b.start_time || ""))
                  );
                }
                return (
                  <div className="space-y-2">
                    {groupList.map((g) => {
                      const isExpanded = expandedSlotId === g.unitId;
                      return (
                        <Card
                          key={g.unitId}
                          className={cn(
                            "cursor-pointer transition-shadow",
                            isExpanded && "ring-2 ring-primary/40 shadow-md",
                          )}
                          onClick={() => setExpandedSlotId(isExpanded ? null : g.unitId)}
                        >
                          <CardContent className="p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                                <span className="font-medium truncate">{g.unitName}</span>
                                <Badge variant="secondary" className="shrink-0">
                                  {g.items.length} {g.items.length === 1 ? "horário" : "horários"}
                                </Badge>
                              </div>
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
                                  isExpanded && "rotate-180",
                                )}
                              />
                            </div>

                            <div
                              className={cn(
                                "grid transition-all duration-300 ease-out",
                                isExpanded ? "grid-rows-[1fr] opacity-100 pt-3 mt-1 border-t" : "grid-rows-[0fr] opacity-0",
                              )}
                            >
                              <div className="overflow-hidden min-h-0">
                                <div className="space-y-2" onClick={(ev) => ev.stopPropagation()}>
                                  {g.items.map((s: any) => (
                                    <div
                                      key={s.id}
                                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 flex-wrap"
                                    >
                                      <div className="flex items-center gap-3 flex-wrap min-w-0">
                                        <span className="font-medium text-sm min-w-[70px]">{DAYS[s.day_of_week]}</span>
                                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                          <Clock className="h-3.5 w-3.5" />
                                          {s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)}
                                        </span>
                                        <div className="flex gap-1 flex-wrap">
                                          <Badge variant="outline">{formatModality(s.modality)}</Badge>
                                          {s.auto_confirm && <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">Auto-confirma</Badge>}
                                        </div>
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Editar"
                                          onClick={() => {
                                            setEditSlotData({
                                              day_of_week: String(s.day_of_week),
                                              modality: s.modality || "presencial",
                                              periods: [{ start_time: s.start_time?.slice(0, 5) || "09:00", end_time: s.end_time?.slice(0, 5) || "17:00", auto_confirm: !!s.auto_confirm }],
                                            });
                                            setEditingSlot(s);
                                          }}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Excluir"
                                          disabled={deletingSlotId === s.id}
                                          onClick={async () => {
                                            setDeletingSlotId(s.id);
                                            try {
                                              await deleteSlot.mutateAsync(s.id);
                                              toast.success("Horário removido com sucesso!");
                                            } catch (e: any) {
                                              toast.error(e.message || "Falha ao remover horário.");
                                            } finally {
                                              setDeletingSlotId(null);
                                            }
                                          }}
                                        >
                                          {deletingSlotId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                );
              })();
            })()
          }
        </CardContent>
      </Card>

      <Dialog open={!!editingSlot} onOpenChange={(open) => { if (!open) setEditingSlot(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Horário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Dia da semana</Label>
              <Select value={editSlotData.day_of_week} onValueChange={v => setEditSlotData(prev => ({ ...prev, day_of_week: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Períodos de disponibilidade</Label>
              {editSlotData.periods.map((period, idx) => (
                <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <span className="text-xs text-muted-foreground">Início</span>
                      <TimeInput value={period.start_time} onChange={v => {
                        const periods = [...editSlotData.periods];
                        periods[idx] = { ...periods[idx], start_time: v };
                        setEditSlotData(p => ({ ...p, periods }));
                      }} />
                    </div>
                    <div className="flex-1">
                      <span className="text-xs text-muted-foreground">Fim</span>
                      <TimeInput value={period.end_time} onChange={v => {
                        const periods = [...editSlotData.periods];
                        periods[idx] = { ...periods[idx], end_time: v };
                        setEditSlotData(p => ({ ...p, periods }));
                      }} />
                    </div>
                    {editSlotData.periods.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => {
                        const periods = editSlotData.periods.filter((_, i) => i !== idx);
                        setEditSlotData(p => ({ ...p, periods }));
                      }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    )}
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer pt-1">
                    <Checkbox
                      checked={period.auto_confirm}
                      onCheckedChange={(c) => {
                        const periods = [...editSlotData.periods];
                        periods[idx] = { ...periods[idx], auto_confirm: !!c };
                        setEditSlotData(p => ({ ...p, periods }));
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium">Auto-confirmar agendamentos neste horário</span>
                      <p className="text-xs text-muted-foreground">O agendamento do candidato já é confirmado, sem precisar de aprovação do recrutador. Uma vez ocupado, esse dia e horário ficam indisponíveis para outros candidatos.</p>
                    </div>
                  </label>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => {
                setEditSlotData(p => ({ ...p, periods: [...p.periods, { start_time: "", end_time: "", auto_confirm: false }] }));
              }}><Plus className="h-4 w-4 mr-1" />Adicionar período</Button>
              <p className="text-xs text-muted-foreground">Ex: 09:00-12:00 (manhã) e 13:00-16:00 (tarde) para pausar no almoço.</p>
            </div>

            <div>
              <Label>Modalidade</Label>
              <ModalityCheckboxes value={editSlotData.modality} onChange={(v) => setEditSlotData(prev => ({ ...prev, modality: v }))} />
            </div>

            <Button
              className="w-full"
              disabled={updateSlot.isPending}
              onClick={async () => {
                if (!editingSlot) return;
                try {
                  const validPeriods = editSlotData.periods.filter(p => p.start_time && p.end_time);
                  if (validPeriods.length === 0) { toast.error("Adicione pelo menos um período válido."); return; }
                  await updateSlot.mutateAsync({
                    id: editingSlot.id,
                    day_of_week: Number(editSlotData.day_of_week),
                    start_time: validPeriods[0].start_time,
                    end_time: validPeriods[0].end_time,
                    modality: editSlotData.modality,
                    auto_confirm: !!validPeriods[0].auto_confirm,
                  });
                  for (let i = 1; i < validPeriods.length; i++) {
                    await createSlot.mutateAsync({
                      unit_id: editingSlot.unit_id,
                      day_of_week: Number(editSlotData.day_of_week),
                      start_time: validPeriods[i].start_time,
                      end_time: validPeriods[i].end_time,
                      modality: editSlotData.modality,
                      auto_confirm: !!validPeriods[i].auto_confirm,
                    });
                  }
                  toast.success("Horário atualizado com sucesso!");
                  setEditingSlot(null);
                } catch (e: any) {
                  toast.error(e.message || "Falha ao atualizar horário.");
                }
              }}
            >
              {updateSlot.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Salvar Alterações
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
