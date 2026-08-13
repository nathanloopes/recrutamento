import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, CalendarOff, Globe, Building2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ymdToLocalDate, dateToLocalYMD, formatDateBR } from "@/lib/dateUtils";

interface BlockedDatesPanelProps {
  unitId?: string;
}

export function BlockedDatesPanel({ unitId }: BlockedDatesPanelProps) {
  const { user, hasRole } = useAuth();
  // Só admin/RH da franqueadora podem criar bloqueio GLOBAL (unit_id nulo).
  // Demais papéis (franqueado/gestor) sempre gravam no escopo da unidade.
  const canGlobal = hasRole("admin") || hasRole("rh_franqueadora");
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newReason, setNewReason] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);

  const { data: blockedDates, isLoading } = useQuery({
    queryKey: ["blocked_dates", unitId],
    queryFn: async () => {
      let q = supabase
        .from("blocked_dates" as any)
        .select("*")
        .order("date", { ascending: true });

      if (unitId) {
        q = q.or(`unit_id.eq.${unitId},unit_id.is.null`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!newDate) throw new Error("Selecione uma data");
      const effectiveGlobal = isGlobal && canGlobal;
      // Evita mandar unit_id=null sem intenção (viraria bloqueio global e
      // seria barrado pelo RLS para quem não é admin/RH). Erro claro no lugar.
      if (!effectiveGlobal && !unitId) {
        throw new Error(
          "Selecione uma unidade no topo da página antes de adicionar o bloqueio" +
          (canGlobal ? ' — ou marque "Feriado global".' : ".")
        );
      }
      const { error } = await supabase.from("blocked_dates" as any).insert({
        date: newDate,
        reason: newReason || null,
        unit_id: effectiveGlobal ? null : unitId,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blocked_dates"] });
      toast.success("Data bloqueada adicionada!");
      setAddOpen(false);
      setNewDate("");
      setNewReason("");
      setIsGlobal(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("blocked_dates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blocked_dates"] });
      toast.success("Bloqueio removido!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const todayYmd = dateToLocalYMD(new Date());
  const futureBlocked = (blockedDates || []).filter((d: any) => d.date >= todayYmd);
  const pastBlocked = (blockedDates || []).filter((d: any) => d.date < todayYmd);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2 min-w-0">
          <CalendarOff className="h-5 w-5 shrink-0" />
          Feriados e Datas Bloqueadas
        </CardTitle>
        <Button size="sm" className="shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />Adicionar Bloqueio
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : futureBlocked.length === 0 && pastBlocked.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma data bloqueada cadastrada.</p>
        ) : (
          <>
            {futureBlocked.length > 0 && (
              <>
                <h4 className="text-sm font-medium mb-2">Próximos bloqueios</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Escopo</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {futureBlocked.map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          {format(ymdToLocalDate(d.date) ?? new Date(), "dd/MM/yyyy (EEEE)", { locale: ptBR })}
                        </TableCell>
                        <TableCell>{d.reason || "—"}</TableCell>
                        <TableCell>
                          {d.unit_id ? (
                            <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" />Unidade</Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1"><Globe className="h-3 w-3" />Global</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(d.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {pastBlocked.length > 0 && (
              <details className="mt-4">
                <summary className="text-sm text-muted-foreground cursor-pointer">Bloqueios passados ({pastBlocked.length})</summary>
                <Table className="mt-2">
                  <TableBody>
                    {pastBlocked.map((d: any) => (
                      <TableRow key={d.id} className="opacity-60">
                        <TableCell>{formatDateBR(d.date)}</TableCell>
                        <TableCell>{d.reason || "—"}</TableCell>
                        <TableCell>{d.unit_id ? "Unidade" : "Global"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adicionar Data Bloqueada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Data</Label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div>
              <Label>Motivo (opcional)</Label>
              <Input placeholder="Ex: Feriado Nacional, Recesso" value={newReason} onChange={(e) => setNewReason(e.target.value)} />
            </div>
            {canGlobal ? (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isGlobal"
                  checked={isGlobal}
                  onChange={(e) => setIsGlobal(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="isGlobal" className="text-sm">Feriado global (aplica a todas as unidades)</Label>
              </div>
            ) : !unitId ? (
              <p className="text-sm text-destructive">
                Selecione uma unidade no topo da página para adicionar um bloqueio.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                O bloqueio será aplicado à unidade selecionada.
              </p>
            )}
            <Button className="w-full" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newDate || (!(isGlobal && canGlobal) && !unitId)}>
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Adicionar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
