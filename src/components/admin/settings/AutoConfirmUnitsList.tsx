import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useAllSlots, useUpdateSlot } from "@/hooks/useScheduling";
import { formatModality } from "@/lib/modalityLabel";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtTime(t?: string) {
  return (t || "").slice(0, 5);
}

export function AutoConfirmUnitsList() {
  const { data: slots, isLoading } = useAllSlots();
  const updateSlot = useUpdateSlot();
  const qc = useQueryClient();
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [bulkLoading, setBulkLoading] = useState<"unit" | "all-on" | "all-off" | null>(null);

  const allSlots = (slots || []) as any[];

  // Todas as unidades que possuem horários configurados (mesmo sem auto-confirm)
  const allUnits = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allSlots) {
      if (s.unit_id) map.set(s.unit_id, s.units?.name || "Unidade sem nome");
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [allSlots]);

  const unitSlots = useMemo(
    () => allSlots.filter((s) => s.unit_id === selectedUnit),
    [allSlots, selectedUnit]
  );
  const unitAutoCount = unitSlots.filter((s) => s.auto_confirm === true).length;
  const unitAllOn = unitSlots.length > 0 && unitAutoCount === unitSlots.length;

  const totalSlots = allSlots.length;
  const totalAuto = allSlots.filter((s) => s.auto_confirm === true).length;
  const globalAllOn = totalSlots > 0 && totalAuto === totalSlots;

  const selectedUnitName = allUnits.find((u) => u.id === selectedUnit)?.name;

  async function bulkUpdate(scope: "unit" | "global", value: boolean) {
    setBulkLoading(scope === "unit" ? "unit" : value ? "all-on" : "all-off");
    try {
      let q = supabase.from("availability_slots").update({ auto_confirm: value }).eq("is_active", true);
      if (scope === "unit") q = q.eq("unit_id", selectedUnit);
      const { error } = await q;
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["availability_slots_all"] });
      await qc.invalidateQueries({ queryKey: ["availability_slots"] });
      toast({
        title: value ? "Auto-confirmação habilitada" : "Auto-confirmação desabilitada",
        description:
          scope === "unit"
            ? `Aplicado aos horários já cadastrados da unidade ${selectedUnitName}.`
            : `Aplicado a todos os horários já cadastrados (${totalSlots}).`,
      });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao atualizar.", variant: "destructive" });
    } finally {
      setBulkLoading(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-confirmação por unidade</CardTitle>
        <CardDescription>
          Marque horários já cadastrados pelas unidades como auto-confirmados. O sistema
          <strong> nunca cria novos horários</strong> — apenas altera o comportamento dos slots
          que a unidade já configurou.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {/* Ação global */}
            <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">Aplicar em todas as unidades</p>
                  <p className="text-xs text-muted-foreground">
                    {totalAuto} de {totalSlots} horários configurados com auto-confirmação.
                    {globalAllOn && " Todos ativos."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={totalSlots === 0 || globalAllOn || bulkLoading !== null}
                    onClick={() => bulkUpdate("global", true)}
                  >
                    {bulkLoading === "all-on" ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 mr-1.5" />
                    )}
                    Habilitar em todas
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={totalAuto === 0 || bulkLoading !== null}
                    onClick={() => bulkUpdate("global", false)}
                  >
                    {bulkLoading === "all-off" ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <ShieldOff className="h-4 w-4 mr-1.5" />
                    )}
                    Desabilitar todas
                  </Button>
                </div>
              </div>
            </div>

            {/* Picker de unidade */}
            <div className="space-y-1 max-w-md">
              <label className="text-sm font-medium text-foreground">Gerenciar por unidade (habilitar ou desabilitar)</label>
              <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma unidade..." />
                </SelectTrigger>
                <SelectContent>
                  {allUnits.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground">
                      Nenhuma unidade com horários cadastrados.
                    </div>
                  ) : (
                    allUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {allUnits.length}{" "}
                {allUnits.length === 1
                  ? "unidade com horários cadastrados"
                  : "unidades com horários cadastrados"}
                .
              </p>
            </div>

            {/* Detalhe da unidade selecionada */}
            {selectedUnit && (
              <div className="rounded-lg border overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 border-b flex-wrap">
                  <div className="space-y-0.5">
                    <h4 className="font-medium text-sm text-foreground">{selectedUnitName}</h4>
                    <p className="text-xs text-muted-foreground">
                      {unitAutoCount} de {unitSlots.length} horários com auto-confirmação ativa
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={unitSlots.length === 0 || unitAllOn || bulkLoading !== null}
                      onClick={() => bulkUpdate("unit", true)}
                    >
                      {bulkLoading === "unit" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 mr-1.5" />
                      )}
                      Habilitar nesta unidade
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unitAutoCount === 0 || bulkLoading !== null}
                      onClick={() => bulkUpdate("unit", false)}
                    >
                      <ShieldOff className="h-4 w-4 mr-1.5" />
                      Desabilitar
                    </Button>
                  </div>
                </div>

                {unitSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">
                    Esta unidade ainda não cadastrou horários de atendimento.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {unitSlots.map((s: any) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-wrap">
                          <Badge variant="outline" className="font-mono">
                            {DAY_LABELS[s.day_of_week] ?? "—"}
                          </Badge>
                          <span className="text-foreground">
                            {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                          </span>
                          <Badge
                            variant="secondary"
                            className="bg-amber-100 text-amber-800 border-amber-300"
                          >
                            {formatModality(s.modality)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {s.auto_confirm ? "Auto-confirmação ativa" : "Aprovação manual"}
                          </span>
                          <Switch
                            checked={!!s.auto_confirm}
                            disabled={updateSlot.isPending}
                            onCheckedChange={(v) =>
                              updateSlot.mutate({ id: s.id, auto_confirm: v })
                            }
                            aria-label="Alternar auto-confirmação deste horário"
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
