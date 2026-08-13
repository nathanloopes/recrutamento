import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, Clock, MapPin, ChevronDown, Pencil, FlaskConical, AlertTriangle } from "lucide-react";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";

import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAllSlots, useCreateSlot, useDeleteSlot, useUpdateSlot } from "@/hooks/useScheduling";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { formatModality } from "@/lib/modalityLabel";

const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Modality = "presencial" | "online" | "ambos";

interface Props {
  selectedUnit: string;
  setSelectedUnit: (u: string) => void;
  units: any[] | undefined;
  scopedUnitIds?: string[];
}

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

function useTestConfig(unitId?: string) {
  return useQuery({
    queryKey: ["unit_test_config", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("unit_test_config")
        .select("*")
        .eq("unit_id", unitId)
        .maybeSingle();
      if (error) throw error;
      return (data as { unit_id: string; enabled: boolean; modality: Modality } | null) ?? null;
    },
  });
}

function useAllTestConfigs(unitIds?: string[]) {
  return useQuery({
    queryKey: ["unit_test_config_all", (unitIds || []).slice().sort().join(",")],
    queryFn: async () => {
      let q = (supabase as any).from("unit_test_config").select("unit_id, enabled, modality");
      if (unitIds && unitIds.length > 0) q = q.in("unit_id", unitIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as { unit_id: string; enabled: boolean; modality: Modality }[];
    },
  });
}

function useSaveTestConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { unit_id: string; enabled: boolean; modality: Modality }) => {
      console.log("[ADMIN][TestPhasePanel] SALVANDO unit_test_config", payload);
      const { data, error } = await (supabase as any)
        .from("unit_test_config")
        .upsert(payload, { onConflict: "unit_id" })
        .select()
        .maybeSingle();
      console.log("[ADMIN][TestPhasePanel] RESPOSTA do banco após upsert", { data, error });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, vars) => {
      console.log("[ADMIN][TestPhasePanel] SALVO com sucesso", { salvo: data, enviado: vars });
      qc.invalidateQueries({ queryKey: ["unit_test_config", vars.unit_id] });
      qc.invalidateQueries({ queryKey: ["unit_test_config_all"] });
    },
  });
}


export function TestPhasePanel({ selectedUnit, setSelectedUnit, units, scopedUnitIds }: Props) {
  // IMPORTANTE: para o super admin (scopedUnitIds indefinido) NÃO enviar a lista
  // completa de unidades no filtro `.in()` — com centenas de unidades a URL do
  // GET estoura o limite e a query falha, deixando a franqueadora sem ver os
  // horários/configs cadastrados pelos franqueados. Passamos `scopedUnitIds`
  // (indefinido = super admin) e confiamos na RLS (que permite ler slots ativos
  // e todas as unit_test_config para autenticados). Franqueado/gestor continua
  // com a lista pequena das suas unidades. Mesmo padrão do SlotsManagerCard.
  const { data: slots, isLoading: slotsLoading } = useAllSlots(
    undefined,
    scopedUnitIds,
    "test",
  );
  const createSlot = useCreateSlot();
  const updateSlot = useUpdateSlot();
  const deleteSlot = useDeleteSlot();

  const { data: cfg, isLoading: cfgLoading } = useTestConfig(selectedUnit || undefined);
  const saveCfg = useSaveTestConfig();
  const qc = useQueryClient();
  const { data: allConfigs } = useAllTestConfigs(scopedUnitIds);

  const [enabled, setEnabled] = useState(false);
  const [modality, setModality] = useState<Modality>("ambos");

  useEffect(() => {
    // Modalidade única "Online + Presencial": o estado é sempre "ambos".
    // Ao salvar uma unidade legada (online/presencial), ela é migrada para o novo fluxo.
    setEnabled(cfg ? !!cfg.enabled : false);
    setModality("ambos");
  }, [cfg, selectedUnit]);

  const [newSlotOpen, setNewSlotOpen] = useState(false);
  
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);
  const [pendingRemoveUnit, setPendingRemoveUnit] = useState<{ unit_id: string; unitName: string } | null>(null);
  const [removingUnit, setRemovingUnit] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [termsProceed, setTermsProceed] = useState(false);
  const { user } = useAuth();

  // reset terms whenever unit/cfg changes or switch turns off
  useEffect(() => {
    setTermsRead(false);
    setTermsProceed(false);
  }, [selectedUnit, cfg?.enabled]);

  useEffect(() => {
    if (!enabled) {
      setTermsRead(false);
      setTermsProceed(false);
    }
  }, [enabled]);

  const termsAccepted = termsRead && termsProceed;
  const hasChanges = !!selectedUnit && (
    enabled !== !!cfg?.enabled ||
    (enabled && modality !== ((cfg?.modality as Modality) || "ambos"))
  );
  // when enabling: require terms; when disabling/no changes from active state: no terms needed
  const canSave = hasChanges && (!enabled || termsAccepted);

  const handleRemoveUnitConfig = async () => {
    if (!pendingRemoveUnit) return;
    setRemovingUnit(true);
    try {
      const uid = pendingRemoveUnit.unit_id;
      const { error: slotErr } = await (supabase as any)
        .from("availability_slots")
        .delete()
        .eq("unit_id", uid)
        .eq("slot_type", "test");
      if (slotErr) throw slotErr;
      const { error: cfgErr } = await (supabase as any)
        .from("unit_test_config")
        .delete()
        .eq("unit_id", uid);
      if (cfgErr) throw cfgErr;
      qc.invalidateQueries({ queryKey: ["unit_test_config", uid] });
      qc.invalidateQueries({ queryKey: ["unit_test_config_all"] });
      qc.invalidateQueries({ queryKey: ["availability_slots"] });
      qc.invalidateQueries({ queryKey: ["availability_slots_all"] });
      if (selectedUnit === uid) setSelectedUnit("");
      toast.success(`"${pendingRemoveUnit.unitName}" removida da configuração de testes.`);
      setPendingRemoveUnit(null);
    } catch (e: any) {
      toast.error(e.message || "Falha ao remover unidade da configuração.");
    } finally {
      setRemovingUnit(false);
    }
  };
  // Horários fixos do teste presencial — não editáveis.
  const FIXED_TEST_PERIODS: ReadonlyArray<{ start_time: string; end_time: string }> = [
    { start_time: "10:00", end_time: "12:00" },
    { start_time: "14:00", end_time: "16:00" },
  ];
  type PeriodOption = { start_time: string; end_time: string; auto_confirm: boolean; enabled: boolean };
  const [newSlot, setNewSlot] = useState<{ day_of_week: string; modality: "presencial" | "online" | "ambos"; periods: PeriodOption[]; online_start: string; online_end: string; online_auto_confirm: boolean }>({
    day_of_week: "1",
    modality: "presencial",
    periods: FIXED_TEST_PERIODS.map((p) => ({ ...p, auto_confirm: false, enabled: true })),
    online_start: "09:00",
    online_end: "10:00",
    online_auto_confirm: false,
  });
  type DayEditForm = {
    modality: "presencial" | "online" | "ambos";
    periods: PeriodOption[];
    online_start: string;
    online_end: string;
    online_auto_confirm: boolean;
  };
  const [editingDay, setEditingDay] = useState<{ unit_id: string; day_of_week: number } | null>(null);
  const [editDayForm, setEditDayForm] = useState<DayEditForm>({
    modality: "presencial",
    periods: FIXED_TEST_PERIODS.map((p) => ({ ...p, auto_confirm: false, enabled: false })),
    online_start: "09:00",
    online_end: "10:00",
    online_auto_confirm: false,
  });


  const handleSaveConfig = async () => {
    if (!selectedUnit) { toast.error("Selecione uma unidade"); return; }
    if (enabled && !termsAccepted) {
      toast.error("Marque as duas caixas de aceite para continuar.");
      return;
    }
    try {
      await saveCfg.mutateAsync({ unit_id: selectedUnit, enabled, modality });

      // audit: only when enabling with terms accepted
      if (enabled && termsAccepted && user?.id) {
        try {
          let userCpf: string | null = null;
          let userName: string | null = (user as any).user_metadata?.full_name || (user as any).email || null;
          const { data: iu } = await (supabase as any)
            .from("internal_users")
            .select("cpf, full_name")
            .eq("user_id", user.id)
            .maybeSingle();
          if (iu) { userCpf = iu.cpf || null; userName = iu.full_name || userName; }
          if (!userCpf) {
            const { data: cand } = await (supabase as any)
              .from("candidates")
              .select("cpf, full_name")
              .eq("user_id", user.id)
              .maybeSingle();
            if (cand) { userCpf = cand.cpf || null; userName = cand.full_name || userName; }
          }
          await (supabase as any).from("unit_test_terms_acceptance").insert({
            unit_id: selectedUnit,
            user_id: user.id,
            user_cpf: userCpf,
            user_name: userName,
            modality,
          });
        } catch (auditErr) {
          console.error("[unit_test_terms_acceptance] insert failed", auditErr);
        }
      }

      toast.success("Configuração salva");
      setTermsRead(false);
      setTermsProceed(false);
      if (enabled && (modality === "presencial" || modality === "ambos")) {
        setExpandedUnitId(selectedUnit);
        setNewSlotOpen(true);
      }
    } catch (e: any) { toast.error(e.message); }
  };


  const handleCreateSlot = async () => {
    if (!selectedUnit) { toast.error("Selecione uma unidade"); return; }
    const dow = parseInt(newSlot.day_of_week);
    const existingForDay = (slots || []).filter(
      (s: any) => s.unit_id === selectedUnit && s.day_of_week === dow,
    );
    const wantsPresencial = newSlot.modality === "presencial" || newSlot.modality === "ambos";
    const wantsOnline = newSlot.modality === "online" || newSlot.modality === "ambos";
    console.log("[ADMIN][TestPhasePanel] NOVO HORÁRIO - estado antes de salvar", {
      selectedUnit,
      day_of_week: dow,
      newSlot,
      wantsPresencial,
      wantsOnline,
      existingForDay,
    });
    try {
      let createdPresencial = 0;
      let createdOnline = 0;


      if (wantsPresencial) {
        const validPeriods = newSlot.periods.filter((p) => p.enabled);
        if (validPeriods.length === 0) {
          toast.error("Selecione ao menos um período (manhã ou tarde)");
          return;
        }
        for (const period of validPeriods) {
          const dup = existingForDay.find(
            (s: any) => s.modality === "presencial" && String(s.start_time).slice(0, 5) === period.start_time,
          );
          if (dup) continue;
          await createSlot.mutateAsync({
            unit_id: selectedUnit,
            day_of_week: dow,
            start_time: period.start_time,
            end_time: period.end_time,
            modality: "presencial",
            auto_confirm: !!period.auto_confirm,
            slot_type: "test",
          });
          createdPresencial++;

        }
      }

      // Online: não usa horário — nenhum slot é criado a partir do dialog.

      // Modalidade única do teste pós-entrevista: sempre "Online + Presencial".
      await saveCfg.mutateAsync({
        unit_id: selectedUnit,
        enabled: true,
        modality: "ambos",
      });
      setEnabled(true);
      setModality("ambos");


      if (!wantsPresencial && wantsOnline) {
        toast.success("Modalidade online — o candidato inicia o teste imediatamente, sem horário.");
      } else {
        const parts: string[] = [];
        if (wantsPresencial) parts.push(`${createdPresencial} presencial`);
        toast.success(
          createdPresencial > 0
            ? `Criado(s): ${parts.join(" + ")}`
            : "Estes horários já estavam cadastrados para este dia.",
        );
      }

      setNewSlotOpen(false);
      setNewSlot({
        day_of_week: "1",
        modality: modality === "online" ? "online" : (modality === "ambos" ? "ambos" : "presencial"),
        periods: FIXED_TEST_PERIODS.map((p) => ({ ...p, auto_confirm: false, enabled: true })),
        online_start: "09:00",
        online_end: "10:00",
        online_auto_confirm: false,
      });
    } catch (e: any) { toast.error(e.message); }
  };

  const unitMap = units?.reduce((acc: Record<string, string>, u: any) => { acc[u.id] = u.name; return acc; }, {}) || {};
  const presencialEnabled = enabled && (modality === "presencial" || modality === "ambos");

  const configuredList = (allConfigs || [])
    .map((c) => ({ ...c, unitName: unitMap[c.unit_id] || "—" }))
    .filter((c) => unitMap[c.unit_id])
    .sort((a, b) => a.unitName.localeCompare(b.unitName, "pt-BR"));

  // group slots by unit for the unified card
  const slotsByUnit = new Map<string, any[]>();
  for (const s of (slots || []) as any[]) {
    const uid = s.unit_id || "__none__";
    if (!slotsByUnit.has(uid)) slotsByUnit.set(uid, []);
    slotsByUnit.get(uid)!.push(s);
  }
  for (const arr of slotsByUnit.values()) {
    arr.sort((a, b) => (a.day_of_week - b.day_of_week) || String(a.start_time || "").localeCompare(String(b.start_time || "")));
  }

  return (
    <div className="space-y-4">
      {/* Configuração do teste */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Testes Técnicos
          </CardTitle>
          <CardDescription>
            Configure se a unidade aplica um teste técnico após a entrevista e como o candidato pode realizá-lo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2 rounded-md border border-border p-4 bg-muted/30">
            <Label className="text-sm font-medium">Unidade</Label>
            <Select value={selectedUnit} onValueChange={setSelectedUnit}>
              <SelectTrigger className="max-w-sm bg-background">
                <SelectValue placeholder="Selecione uma unidade" />
              </SelectTrigger>
              <SelectContent>
                {units?.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A configuração de teste é por unidade. Escolha qual unidade deseja configurar.
            </p>
          </div>

          {!selectedUnit ? (
            <p className="text-xs text-muted-foreground">Selecione uma unidade acima para começar.</p>
          ) : cfgLoading ? (
            <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-4">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Ativar teste técnico após a entrevista</Label>
                  <p className="text-xs text-muted-foreground">
                    Quando ligado, o candidato aprovado na entrevista é direcionado para realizar o teste técnico antes da contratação.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className={cn("space-y-2", !enabled && "opacity-60 pointer-events-none")}>
                <Label className="text-sm">Modalidade do teste</Label>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 max-w-xs">
                  <FlaskConical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">Online + Presencial</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  O candidato realiza primeiro o teste online (obrigatório) e, ao concluir,
                  agenda o teste presencial conforme a disponibilidade da unidade abaixo.
                </p>
              </div>

              {enabled && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-2 text-sm text-amber-900">
                      <p className="font-semibold">Orientação sobre a Realização de dia teste presencial</p>
                      <p>
                        A prática de convidar candidatos para realizar um "dia teste" na unidade demanda atenção especial,
                        uma vez que pode configurar risco de reconhecimento de vínculo empregatício e gerar passivos
                        trabalhistas para o franqueado.
                      </p>
                      <p>
                        Cada caso possui particularidades próprias, e a avaliação dos riscos envolvidos deve levar em
                        consideração a legislação vigente, a jurisprudência aplicável e as circunstâncias específicas de
                        cada unidade.
                      </p>
                      <p>
                        Recomendamos, portanto, que o franqueado consulte previamente seu escritório de contabilidade,
                        assessoria jurídica ou outro profissional especializado de sua confiança, a fim de obter
                        orientação adequada e tomar a decisão mais segura para o seu negócio antes de adotar essa prática.
                      </p>
                      <p>
                        Esclarecemos que a decisão de realizar ou não o "dia teste", bem como a forma de sua condução, é
                        de exclusiva responsabilidade do franqueado. A franqueadora não supervisiona, orienta ou se
                        responsabiliza por quaisquer riscos, consequências ou passivos decorrentes dessa prática.
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox checked={termsRead} onCheckedChange={(c) => setTermsRead(!!c)} className="mt-0.5" />
                    <span className="text-sm text-amber-900">
                      Declaro que li e compreendi integralmente as orientações acima, estando ciente dos riscos
                      trabalhistas envolvidos na realização do "dia teste", e reconheço que a decisão de realizá-lo é de
                      minha exclusiva responsabilidade, não cabendo qualquer responsabilidade à franqueadora.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox checked={termsProceed} onCheckedChange={(c) => setTermsProceed(!!c)} className="mt-0.5" />
                    <span className="text-sm text-amber-900">Estou ciente e desejo prosseguir.</span>
                  </label>

                  <div className="flex justify-end pt-1">
                    <Button
                      onClick={handleSaveConfig}
                      disabled={saveCfg.isPending || !canSave}
                      title={!hasChanges ? "Nenhuma alteração para salvar." : !termsAccepted ? "Marque as duas caixas de aceite." : ""}
                    >
                      {saveCfg.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                      Salvar configuração
                    </Button>
                  </div>
                </div>
              )}

              {!enabled && (
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveConfig}
                    disabled={saveCfg.isPending || !canSave}
                    title={!hasChanges ? "Nenhuma alteração para salvar." : ""}
                  >
                    {saveCfg.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    Salvar configuração
                  </Button>
                </div>
              )}

            </>
          )}

          {/* Unidades configuradas (unificado: status + modalidade + horários) */}
          {configuredList.length > 0 && (
            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex flex-row items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <h4 className="text-base font-semibold leading-none tracking-tight">Unidades configuradas</h4>
                  <p className="text-sm text-muted-foreground">
                    Clique numa unidade para ver os horários e editar a configuração de teste dela abaixo.
                  </p>
                </div>
                {(() => {
                  const selCfg = configuredList.find((c) => c.unit_id === selectedUnit);
                  const selCanAdd = !!selCfg && selCfg.enabled;
                  return (
                    <Button
                      size="sm"
                      onClick={() => setNewSlotOpen(true)}
                      disabled={!selectedUnit || !selCanAdd}
                      title={!selectedUnit ? "Selecione uma unidade" : !selCanAdd ? "Ative o teste primeiro" : ""}
                    >
                      <Plus className="h-4 w-4 mr-1" />Novo Horário
                    </Button>
                  );
                })()}
              </div>


            <div className="space-y-2">
              {configuredList.map((c) => {
                const isSelected = selectedUnit === c.unit_id;
                const isExpanded = expandedUnitId === c.unit_id;
                const unitSlots = slotsByUnit.get(c.unit_id) || [];
                const showsSlots = c.enabled;
                return (
                  <Card
                    key={c.unit_id}
                    className={cn(
                      "transition-shadow",
                      isSelected && "ring-2 ring-primary/40 shadow-sm",
                    )}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => { setSelectedUnit(c.unit_id); setExpandedUnitId(isExpanded ? null : c.unit_id); }}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left flex-wrap"
                        >
                          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm truncate">{c.unitName}</span>
                          {c.enabled ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 shrink-0">Ativo</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-muted-foreground shrink-0">Inativo</Badge>
                          )}
                          {c.enabled && (
                            <Badge variant="secondary" className="shrink-0">{formatModality(c.modality)}</Badge>
                          )}
                          {showsSlots && (
                            <Badge variant="outline" className="shrink-0">
                              {unitSlots.length} {unitSlots.length === 1 ? "horário" : "horários"}
                            </Badge>
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Remover unidade da configuração"
                            onClick={(e) => { e.stopPropagation(); setPendingRemoveUnit({ unit_id: c.unit_id, unitName: c.unitName }); }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          <ChevronDown
                            className={cn("h-4 w-4 text-muted-foreground transition-transform cursor-pointer", isExpanded && "rotate-180")}
                            onClick={() => setExpandedUnitId(isExpanded ? null : c.unit_id)}
                          />
                        </div>
                      </div>
                      <div className={cn("grid transition-all duration-300 ease-out", isExpanded ? "grid-rows-[1fr] opacity-100 pt-2 mt-1 border-t" : "grid-rows-[0fr] opacity-0")}>
                        <div className="overflow-hidden min-h-0">
                          {!showsSlots ? (
                            <p className="text-xs text-muted-foreground py-2">
                              Esta unidade não tem teste ativo — não há horários a exibir.
                            </p>
                          ) : unitSlots.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">
                              Nenhum horário cadastrado. Selecione esta unidade e use <strong>+ Novo Horário</strong> abaixo.
                            </p>
                          ) : (
                            <div className="space-y-2 pt-1">
                              {unitSlots.map((s: any) => (
                                <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2 flex-wrap">
                                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                                    <span className="font-medium text-sm min-w-[70px]">{DAYS[s.day_of_week]}</span>
                                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                      <Clock className="h-3.5 w-3.5" />
                                      {s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)}
                                    </span>
                                    <Badge variant="outline" className="shrink-0">{formatModality(s.modality)}</Badge>
                                    {s.auto_confirm && <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">Auto-confirma</Badge>}
                                  </div>
                                  <div className="flex gap-1">
                                    <Button size="icon" variant="ghost" title="Editar" onClick={() => {
                                      const daySlots = ((slots || []) as any[]).filter(
                                        (x: any) => x.unit_id === s.unit_id && x.day_of_week === s.day_of_week,
                                      );
                                      const presSlots = daySlots.filter((x: any) => x.modality === "presencial" || x.modality === "ambos");
                                      const onlineSlot = daySlots.find((x: any) => x.modality === "online" || x.modality === "ambos");
                                      const periods: PeriodOption[] = FIXED_TEST_PERIODS.map((p) => {
                                        const match = presSlots.find((x: any) => String(x.start_time).slice(0, 5) === p.start_time);
                                        return {
                                          start_time: p.start_time,
                                          end_time: p.end_time,
                                          auto_confirm: match ? !!match.auto_confirm : false,
                                          enabled: !!match,
                                        };
                                      });
                                      const hasPres = presSlots.length > 0;
                                      const hasOnline = !!onlineSlot;
                                      const nextEditForm = {
                                        modality: hasPres && hasOnline ? "ambos" : hasOnline ? "online" : "presencial",
                                        periods,
                                        online_start: onlineSlot ? String(onlineSlot.start_time).slice(0, 5) : "09:00",
                                        online_end: onlineSlot ? String(onlineSlot.end_time).slice(0, 5) : "10:00",
                                        online_auto_confirm: onlineSlot ? !!onlineSlot.auto_confirm : false,
                                      } as DayEditForm;
                                      console.log("[ADMIN][TestPhasePanel] EDITAR HORÁRIO - abrindo formulário", {
                                        unit_id: s.unit_id,
                                        day_of_week: s.day_of_week,
                                        daySlots,
                                        presSlots,
                                        onlineSlot,
                                        editForm: nextEditForm,
                                      });
                                      setEditDayForm({
                                        ...nextEditForm,
                                      });
                                      setEditingDay({ unit_id: s.unit_id, day_of_week: s.day_of_week });
                                    }}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>

                                    <Button size="icon" variant="ghost" title="Excluir" disabled={deletingSlotId === s.id} onClick={async () => {
                                      setDeletingSlotId(s.id);
                                      try {
                                        await deleteSlot.mutateAsync(s.id);
                                        toast.success("Horário removido com sucesso!");
                                      } catch (e: any) {
                                        toast.error(e.message || "Falha ao remover horário.");
                                      } finally { setDeletingSlotId(null); }
                                    }}>
                                      {deletingSlotId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {showsSlots && (
                            <div className="pt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setSelectedUnit(c.unit_id); setNewSlotOpen(true); }}
                              >
                                <Plus className="h-4 w-4 mr-1" />Novo Horário
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            </div>
          )}
        </CardContent>
      </Card>




      {/* Dialog: Novo Horário de Teste — presencial usa blocos fixos, online é livre */}
      <Dialog
        open={newSlotOpen}
        onOpenChange={(open) => {
          setNewSlotOpen(open);
          if (open) {
            // Sincroniza a modalidade padrão do dialog com a config da unidade
            setNewSlot(prev => ({
              ...prev,
              modality: modality === "online" ? "online" : (modality === "ambos" ? "ambos" : "presencial"),
            }));
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo Horário de Teste</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Modalidade do teste</Label>
              <Select
                value={newSlot.modality}
                onValueChange={(v) => setNewSlot(p => ({ ...p, modality: v as "presencial" | "online" | "ambos" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="presencial">Presencial (blocos fixos)</SelectItem>
                  <SelectItem value="online">Online (horário livre)</SelectItem>
                  <SelectItem value="ambos">Ambos (presencial + online)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {newSlot.modality === "presencial"
                  ? "Presencial usa blocos fixos: 10h-12h (manhã) e 14h-16h (tarde)."
                  : newSlot.modality === "online"
                    ? "Online não usa horário: o candidato inicia o teste imediatamente após a aprovação na entrevista."
                    : "Presencial usa blocos fixos abaixo. Online não requer horário — o candidato inicia imediatamente."}
              </p>
            </div>

            {(newSlot.modality === "online" || newSlot.modality === "ambos") && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                <p className="font-semibold mb-1">Modalidade online</p>
                <p>
                  Não é necessário cadastrar horários. Ao escolher <strong>Online</strong>, o candidato inicia o teste imediatamente após a aprovação na entrevista — sem agendamento.
                </p>
              </div>
            )}



            <div>
              <Label>Dia da semana</Label>
              <Select value={newSlot.day_of_week} onValueChange={v => setNewSlot(p => ({ ...p, day_of_week: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {(newSlot.modality === "presencial" || newSlot.modality === "ambos") && (
              <div className="space-y-2">
                <Label>Presencial — períodos disponíveis</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {newSlot.periods.map((period, idx) => {
                    const periodLabel = period.start_time === "10:00" ? "Manhã" : "Tarde";
                    return (
                      <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={period.enabled} onCheckedChange={(c) => {
                            const periods = [...newSlot.periods];
                            periods[idx] = { ...periods[idx], enabled: !!c };
                            setNewSlot(p => ({ ...p, periods }));
                          }} />
                          <span className="flex flex-col text-sm">
                            <span className="font-semibold">{periodLabel}</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {period.start_time} - {period.end_time}
                            </span>
                          </span>
                        </label>
                        <label className={cn("flex items-start gap-2 cursor-pointer pt-1", !period.enabled && "opacity-50 pointer-events-none")}>
                          <Checkbox checked={period.auto_confirm} onCheckedChange={(c) => {
                            const periods = [...newSlot.periods];
                            periods[idx] = { ...periods[idx], auto_confirm: !!c };
                            setNewSlot(p => ({ ...p, periods }));
                          }} className="mt-0.5" />
                          <div className="flex-1">
                            <span className="text-xs font-medium">Auto-confirmar</span>
                            <p className="text-[11px] text-muted-foreground leading-tight">Confirma sem aprovação do recrutador.</p>
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


            <Button className="w-full" onClick={handleCreateSlot} disabled={createSlot.isPending}>
              {createSlot.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {newSlot.modality === "ambos"
                ? "Criar horários"
                : newSlot.modality === "presencial"
                  ? `Criar ${newSlot.periods.filter(p => p.enabled).length} período(s)`
                  : "Criar horário"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>



      {/* Edit day dialog — mesmo layout do novo horário, dia fixo */}
      <Dialog open={!!editingDay} onOpenChange={(open) => { if (!open) setEditingDay(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Editar Horário de Teste</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Modalidade do teste</Label>
              <Select
                value={editDayForm.modality}
                onValueChange={(v) => setEditDayForm(p => {
                  const next = v as "presencial" | "online" | "ambos";
                  // Ao habilitar presencial e não haver período marcado, marca Manhã por padrão
                  if ((next === "presencial" || next === "ambos") && !p.periods.some(pp => pp.enabled)) {
                    return { ...p, modality: next, periods: p.periods.map((pp, i) => ({ ...pp, enabled: i === 0 })) };
                  }
                  return { ...p, modality: next };
                })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="presencial">Presencial (blocos fixos)</SelectItem>
                  <SelectItem value="online">Online (horário livre)</SelectItem>
                  <SelectItem value="ambos">Ambos (presencial + online)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(editDayForm.modality === "online" || editDayForm.modality === "ambos") && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                <p className="font-semibold mb-1">Modalidade online</p>
                <p>
                  Não é necessário cadastrar horários. Ao escolher <strong>Online</strong>, o candidato inicia o teste imediatamente após a aprovação na entrevista — sem agendamento.
                </p>
              </div>
            )}


            <div>
              <Label>Dia da semana</Label>
              <Select value={String(editingDay?.day_of_week ?? "1")} disabled>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Para mudar de dia, exclua os horários e crie novos no dia desejado.
              </p>
            </div>

            {(editDayForm.modality === "presencial" || editDayForm.modality === "ambos") && (
              <div className="space-y-2">
                <Label>Presencial — períodos disponíveis</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {editDayForm.periods.map((period, idx) => {
                    const periodLabel = period.start_time === "10:00" ? "Manhã" : "Tarde";
                    return (
                      <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox checked={period.enabled} onCheckedChange={(c) => {
                            const periods = [...editDayForm.periods];
                            periods[idx] = { ...periods[idx], enabled: !!c };
                            setEditDayForm(p => ({ ...p, periods }));
                          }} />
                          <span className="flex flex-col text-sm">
                            <span className="font-semibold">{periodLabel}</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {period.start_time} - {period.end_time}
                            </span>
                          </span>
                        </label>
                        <label className={cn("flex items-start gap-2 cursor-pointer pt-1", !period.enabled && "opacity-50 pointer-events-none")}>
                          <Checkbox checked={period.auto_confirm} onCheckedChange={(c) => {
                            const periods = [...editDayForm.periods];
                            periods[idx] = { ...periods[idx], auto_confirm: !!c };
                            setEditDayForm(p => ({ ...p, periods }));
                          }} className="mt-0.5" />
                          <div className="flex-1">
                            <span className="text-xs font-medium">Auto-confirmar</span>
                            <p className="text-[11px] text-muted-foreground leading-tight">Confirma sem aprovação do recrutador.</p>
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


            <Button className="w-full" disabled={updateSlot.isPending || createSlot.isPending || deleteSlot.isPending} onClick={async () => {
              if (!editingDay) return;
              const wantsPresencial = editDayForm.modality === "presencial" || editDayForm.modality === "ambos";
              const anyPeriod = editDayForm.periods.some(p => p.enabled);
              if (wantsPresencial && !anyPeriod) {
                toast.error("Selecione ao menos um período (manhã ou tarde)");
                return;
              }
              try {
                const daySlots = ((slots || []) as any[]).filter(
                  (x: any) => x.unit_id === editingDay.unit_id && x.day_of_week === editingDay.day_of_week,
                );
                console.log("[ADMIN][TestPhasePanel] EDITAR HORÁRIO - salvando", {
                  editingDay,
                  editDayForm,
                  wantsPresencial,
                  daySlotsAntes: daySlots,
                });
                // Presencial reconcile
                for (const period of editDayForm.periods) {
                  const existing = daySlots.find(
                      (x: any) => (x.modality === "presencial" || x.modality === "ambos") && String(x.start_time).slice(0, 5) === period.start_time,
                  );
                  if (wantsPresencial && period.enabled) {
                    if (existing) {
                      if (!!existing.auto_confirm !== !!period.auto_confirm) {
                        await updateSlot.mutateAsync({
                          id: existing.id,
                          day_of_week: editingDay.day_of_week,
                          start_time: period.start_time,
                          end_time: period.end_time,
                          modality: "presencial",
                          auto_confirm: !!period.auto_confirm,
                        });
                      }
                    } else {
                      await createSlot.mutateAsync({
                        unit_id: editingDay.unit_id,
                        day_of_week: editingDay.day_of_week,
                        start_time: period.start_time,
                        end_time: period.end_time,
                        modality: "presencial",
                        auto_confirm: !!period.auto_confirm,
                        slot_type: "test",
                      });
                    }
                  } else if (existing) {
                    await deleteSlot.mutateAsync(existing.id);
                  }
                }
                // Online: não usa horário — nenhum slot é criado/atualizado a partir do dialog.

                // Modalidade única do teste pós-entrevista: sempre "Online + Presencial".
                await saveCfg.mutateAsync({
                  unit_id: editingDay.unit_id,
                  enabled: true,
                  modality: "ambos",
                });
                if (selectedUnit === editingDay.unit_id) {
                  setEnabled(true);
                  setModality("ambos");
                }
                toast.success("Horários atualizados!");

                setEditingDay(null);
              } catch (e: any) { toast.error(e.message); }
            }}>
              {(updateSlot.isPending || createSlot.isPending || deleteSlot.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Salvar
            </Button>
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              disabled={deleteSlot.isPending}
              onClick={async () => {
                if (!editingDay) return;
                if (!window.confirm("Excluir todos os horários deste dia?")) return;
                try {
                  const daySlots = ((slots || []) as any[]).filter(
                    (x: any) => x.unit_id === editingDay.unit_id && x.day_of_week === editingDay.day_of_week,
                  );
                  for (const s of daySlots) {
                    await deleteSlot.mutateAsync(s.id);
                  }
                  await saveCfg.mutateAsync({
                    unit_id: editingDay.unit_id,
                    enabled: true,
                    modality: "ambos",
                  });
                  if (selectedUnit === editingDay.unit_id) {
                    setEnabled(true);
                    setModality("ambos");
                  }
                  toast.success("Horários do dia removidos!");
                  setEditingDay(null);

                } catch (e: any) { toast.error(e.message); }
              }}
            >
              {deleteSlot.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Excluir dia
            </Button>
          </div>
        </DialogContent>
      </Dialog>



      <DoubleConfirmDialog
        open={!!pendingRemoveUnit}
        onOpenChange={(o) => { if (!o && !removingUnit) setPendingRemoveUnit(null); }}
        title="Remover unidade da configuração?"
        description={pendingRemoveUnit ? `A configuração de teste de "${pendingRemoveUnit.unitName}" e todos os horários presenciais cadastrados para ela serão removidos. Esta ação não pode ser desfeita.` : ""}
        confirmLabel="Remover unidade"
        loading={removingUnit}
        onConfirm={handleRemoveUnitConfig}
      />
    </div>
  );
}
