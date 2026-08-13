import { useMemo, useState } from "react";
import { Loader2, Link2, Trash2, Pencil, Plus, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnits } from "@/hooks/useUnitJobs";
import {
  useScheduleGroupsWithUnits,
  useCreateScheduleGroup,
  useUpdateScheduleGroup,
  useDeleteScheduleGroup,
} from "@/hooks/useScheduleGroups";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { toast } from "sonner";

type EditingGroup = { id?: string; name: string; unitIds: string[] } | null;

export function ScheduleGroupsPanel() {
  const { data: groups, isLoading } = useScheduleGroupsWithUnits();
  const { data: allUnits } = useUnits();
  const create = useCreateScheduleGroup();
  const update = useUpdateScheduleGroup();
  const remove = useDeleteScheduleGroup();

  const [editing, setEditing] = useState<EditingGroup>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [unitSearch, setUnitSearch] = useState("");

  // Unidades já vinculadas a outros grupos (não podem ser selecionadas)
  const lockedByOther = useMemo(() => {
    const map = new Map<string, string>(); // unitId -> groupId
    (groups || []).forEach((g) => g.units.forEach((u) => map.set(u.id, g.id)));
    return map;
  }, [groups]);

  const openNew = () => {
    setUnitSearch("");
    setEditing({ name: "", unitIds: [] });
  };
  const openEdit = (g: any) => {
    setUnitSearch("");
    setEditing({ id: g.id, name: g.name || "", unitIds: g.units.map((u: any) => u.id) });
  };

  const save = async () => {
    if (!editing) return;
    if (editing.unitIds.length < 2) {
      toast.error("Selecione pelo menos 2 unidades.");
      return;
    }
    try {
      if (editing.id) {
        await update.mutateAsync({ groupId: editing.id, name: editing.name, unitIds: editing.unitIds });
        toast.success("Grupo atualizado.");
      } else {
        await create.mutateAsync({ name: editing.name, unitIds: editing.unitIds });
        toast.success("Grupo criado.");
      }
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar grupo");
    }
  };

  const confirmRemove = async () => {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync(confirmDelete);
      toast.success("Grupo desfeito. Cada unidade volta a ter sua agenda independente.");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao remover grupo");
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Unificar Agenda
          </CardTitle>
          <CardDescription>
            Agrupe unidades que compartilham o mesmo recrutador. Os horários de cada unidade continuam independentes,
            mas a ocupação de entrevistas e testes passa a ser compartilhada — impedindo agendamentos simultâneos.
          </CardDescription>
        </div>
        <Button size="sm" onClick={openNew} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" />
          Novo grupo
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (groups || []).length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum grupo de agenda criado. Cada unidade mantém sua agenda individual.
          </div>
        ) : (
          (groups || []).map((g) => (
            <div key={g.id} className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="font-medium">{g.name || "Grupo sem nome"}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.units.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Sem unidades vinculadas</span>
                  ) : (
                    g.units.map((u) => (
                      <Badge key={u.id} variant="secondary" className="text-xs">{u.name}</Badge>
                    ))
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => openEdit(g)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(g.id)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Desfazer
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {/* Dialog editar/criar */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar grupo de agenda" : "Novo grupo de agenda"}</DialogTitle>
            <DialogDescription>
              Selecione 2 ou mais unidades. Elas vão compartilhar a ocupação dos horários, mas cada uma manterá
              suas próprias janelas de funcionamento.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Nome do grupo (opcional)</Label>
                <Input
                  value={editing.name}
                  placeholder="Ex.: Recrutador João"
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Unidades</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar unidade..."
                    value={unitSearch}
                    onChange={(e) => setUnitSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                  {(allUnits || [])
                    .filter((u: any) => {
                      if (!unitSearch.trim()) return true;
                      return (u.name || "").toLowerCase().includes(unitSearch.trim().toLowerCase());
                    })
                    .map((u: any) => {
                    const otherGroupId = lockedByOther.get(u.id);
                    const lockedElsewhere = !!otherGroupId && otherGroupId !== editing.id;
                    const checked = editing.unitIds.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${lockedElsewhere ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50"}`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={lockedElsewhere}
                          onCheckedChange={(v) => {
                            if (lockedElsewhere) return;
                            setEditing({
                              ...editing,
                              unitIds: v ? [...editing.unitIds, u.id] : editing.unitIds.filter((id) => id !== u.id),
                            });
                          }}
                        />
                        <span className="flex-1 text-sm">{u.name}</span>
                        {lockedElsewhere && <span className="text-xs text-muted-foreground">já em outro grupo</span>}
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {editing.unitIds.length} unidade(s) selecionada(s). Mínimo: 2.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={create.isPending || update.isPending}>
              {(create.isPending || update.isPending) && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DoubleConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Desfazer grupo de agenda?"
        description="As unidades voltarão a ter agendas totalmente independentes. Agendamentos existentes não são afetados."
        confirmLabel="Desfazer grupo"
        onConfirm={confirmRemove}
      />
    </Card>
  );
}
