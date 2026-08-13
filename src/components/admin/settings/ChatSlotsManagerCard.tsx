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
import { Plus, Trash2, Pencil, Loader2, ChevronDown, MapPin, Clock, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useChatSlots,
  useCreateChatSlot,
  useDeleteChatSlot,
  useUpdateChatSlot,
} from "@/hooks/useChatScheduling";

const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * Card independente para configurar horários semanais do Bate-Papo Pós-Teste.
 * Não compartilha estado, hooks ou tabela com o card de horários da Entrevista.
 */
export function ChatSlotsManagerCard() {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const scopedUnitIds = !isSuperAdmin && myUnitIds.length > 0 ? myUnitIds : undefined;

  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [newSlotOpen, setNewSlotOpen] = useState(false);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<any>(null);
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  const [editSlotData, setEditSlotData] = useState({
    day_of_week: "1",
    periods: [{ start_time: "09:00", end_time: "17:00", auto_confirm: false }],
  });
  const [newSlot, setNewSlot] = useState({
    day_of_week: "1",
    periods: [
      { start_time: "09:00", end_time: "12:00", auto_confirm: false },
      { start_time: "13:00", end_time: "17:00", auto_confirm: false },
    ],
  });

  const { data: units } = useQuery({
    queryKey: ["units_list_chat", isSuperAdmin, myUnitIds],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").eq("is_active", true).order("name");
      if (!isSuperAdmin && myUnitIds.length > 0) q = q.in("id", myUnitIds);
      const { data, error } = await q;
      if (error) throw error;
      if (data?.length === 1 && !selectedUnit) setSelectedUnit(data[0].id);
      return data;
    },
  });

  const { data: slots, isLoading } = useChatSlots(selectedUnit || undefined, !selectedUnit ? scopedUnitIds : undefined);
  const createSlot = useCreateChatSlot();
  const updateSlot = useUpdateChatSlot();
  const deleteSlot = useDeleteChatSlot();

  const handleCreate = async () => {
    if (!selectedUnit) { toast.error("Selecione uma unidade"); return; }
    const valid = newSlot.periods.filter(p => p.start_time && p.end_time && p.start_time < p.end_time);
    if (valid.length === 0) { toast.error("Adicione pelo menos um período válido"); return; }
    try {
      for (const p of valid) {
        await createSlot.mutateAsync({
          unit_id: selectedUnit,
          day_of_week: parseInt(newSlot.day_of_week),
          start_time: p.start_time,
          end_time: p.end_time,
          auto_confirm: !!p.auto_confirm,
        });
      }
      toast.success(`${valid.length} período(s) criado(s)!`);
      setNewSlotOpen(false);
      setNewSlot({
        day_of_week: "1",
        periods: [
          { start_time: "09:00", end_time: "12:00", auto_confirm: false },
          { start_time: "13:00", end_time: "17:00", auto_confirm: false },
        ],
      });
    } catch (e: any) { toast.error(e.message); }
  };

  const handleUpdate = async () => {
    if (!editingSlot) return;
    const p = editSlotData.periods[0];
    if (!p?.start_time || !p?.end_time || p.start_time >= p.end_time) {
      toast.error("Período inválido"); return;
    }
    try {
      await updateSlot.mutateAsync({
        id: editingSlot.id,
        day_of_week: parseInt(editSlotData.day_of_week),
        start_time: p.start_time,
        end_time: p.end_time,
        auto_confirm: !!p.auto_confirm,
      });
      toast.success("Horário atualizado!");
      setEditingSlot(null);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              Horários disponíveis pós teste
            </CardTitle>
            <CardDescription>
              Slots semanais exclusivos do bate-papo final com o candidato após o teste. Independente da agenda de entrevistas.
            </CardDescription>
          </div>
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
                <DialogHeader><DialogTitle>Novo Horário — Bate-Papo</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Dia da semana</Label>
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
                            <p className="text-xs text-muted-foreground">O bate-papo do candidato já é confirmado, sem precisar de aprovação do recrutador.</p>
                          </div>
                        </label>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => {
                      setNewSlot(p => ({ ...p, periods: [...p.periods, { start_time: "", end_time: "", auto_confirm: false }] }));
                    }}><Plus className="h-4 w-4 mr-1" />Adicionar período</Button>
                  </div>

                  <Button className="w-full" onClick={handleCreate} disabled={createSlot.isPending}>
                    {createSlot.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Criar {newSlot.periods.filter(p => p.start_time && p.end_time).length} período(s)
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (() => {
            const list = slots || [];
            const unitMap = units?.reduce((acc: Record<string, string>, u: any) => { acc[u.id] = u.name; return acc; }, {}) || {};
            if (!list.length) {
              return <p className="text-muted-foreground text-sm text-center py-4">Nenhum horário de bate-papo cadastrado{selectedUnit ? " para esta unidade" : ""}.</p>;
            }
            const groups = new Map<string, { unitId: string; unitName: string; items: any[] }>();
            for (const s of list) {
              const uid = s.unit_id || "__none__";
              const uname = unitMap[s.unit_id] || "Sem unidade";
              if (!groups.has(uid)) groups.set(uid, { unitId: uid, unitName: uname, items: [] });
              groups.get(uid)!.items.push(s);
            }
            const groupList = Array.from(groups.values()).sort((a, b) => a.unitName.localeCompare(b.unitName, "pt-BR"));
            return (
              <div className="space-y-2">
                {groupList.map((g) => {
                  const isExpanded = expandedUnitId === g.unitId;
                  return (
                    <Card
                      key={g.unitId}
                      className={cn("cursor-pointer transition-shadow", isExpanded && "ring-2 ring-primary/40 shadow-md")}
                      onClick={() => setExpandedUnitId(isExpanded ? null : g.unitId)}
                    >
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium truncate">{g.unitName}</span>
                            <Badge variant="secondary" className="shrink-0">{g.items.length} {g.items.length === 1 ? "horário" : "horários"}</Badge>
                          </div>
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0", isExpanded && "rotate-180")} />
                        </div>
                        <div className={cn("grid transition-all duration-300 ease-out", isExpanded ? "grid-rows-[1fr] opacity-100 pt-3 mt-1 border-t" : "grid-rows-[0fr] opacity-0")}>
                          <div className="overflow-hidden min-h-0">
                            <div className="space-y-2" onClick={(ev) => ev.stopPropagation()}>
                              {g.items.map((s: any) => (
                                <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 flex-wrap">
                                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                                    <span className="font-medium text-sm min-w-[70px]">{DAYS[s.day_of_week]}</span>
                                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                      <Clock className="h-3.5 w-3.5" />
                                      {s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)}
                                    </span>
                                    {s.auto_confirm && <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">Auto-confirma</Badge>}
                                  </div>
                                  <div className="flex gap-1">
                                    <Button size="icon" variant="ghost" title="Editar" onClick={() => {
                                      setEditSlotData({
                                        day_of_week: String(s.day_of_week),
                                        periods: [{ start_time: s.start_time?.slice(0, 5) || "09:00", end_time: s.end_time?.slice(0, 5) || "17:00", auto_confirm: !!s.auto_confirm }],
                                      });
                                      setEditingSlot(s);
                                    }}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" title="Excluir" disabled={deletingSlotId === s.id} onClick={async () => {
                                      setDeletingSlotId(s.id);
                                      try {
                                        await deleteSlot.mutateAsync(s.id);
                                        toast.success("Horário removido com sucesso!");
                                      } catch (e: any) { toast.error(e.message || "Falha ao remover"); }
                                      finally { setDeletingSlotId(null); }
                                    }}>
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
          })()}
        </CardContent>
      </Card>

      <Dialog open={!!editingSlot} onOpenChange={(o) => !o && setEditingSlot(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Horário — Bate-Papo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Dia da semana</Label>
              <Select value={editSlotData.day_of_week} onValueChange={v => setEditSlotData(p => ({ ...p, day_of_week: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <span className="text-xs text-muted-foreground">Início</span>
                  <TimeInput value={editSlotData.periods[0].start_time} onChange={v => setEditSlotData(p => ({ ...p, periods: [{ ...p.periods[0], start_time: v }] }))} />
                </div>
                <div className="flex-1">
                  <span className="text-xs text-muted-foreground">Fim</span>
                  <TimeInput value={editSlotData.periods[0].end_time} onChange={v => setEditSlotData(p => ({ ...p, periods: [{ ...p.periods[0], end_time: v }] }))} />
                </div>
              </div>
              <label className="flex items-start gap-2 cursor-pointer pt-1">
                <Checkbox
                  checked={editSlotData.periods[0].auto_confirm}
                  onCheckedChange={(c) => setEditSlotData(p => ({ ...p, periods: [{ ...p.periods[0], auto_confirm: !!c }] }))}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium">Auto-confirmar agendamentos neste horário</span>
                </div>
              </label>
            </div>
            <Button className="w-full" onClick={handleUpdate} disabled={updateSlot.isPending}>
              {updateSlot.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Salvar alterações
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
