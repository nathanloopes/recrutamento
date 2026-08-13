import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UnitJobInheritedSelector } from "@/components/admin/UnitJobInheritedSelector";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  job: any | null;
  /** Unidades vinculadas ao usuário e autorizadas a personalizar */
  allowedUnitIds: string[];
}

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

const unionSelected = (rows: any[], field: string, master: string[]) => {
  if (!rows.length) return master;
  const set = new Set<string>();
  let anyHasOverride = false;
  for (const r of rows) {
    const ov = r[field];
    if (Array.isArray(ov)) {
      anyHasOverride = true;
      ov.forEach((x: string) => master.includes(x) && set.add(x));
    } else {
      // sem override = herda master inteiro
      master.forEach((x) => set.add(x));
    }
  }
  return anyHasOverride ? Array.from(set) : master;
};

export function UnitOverrideForJobDialog({ open, onOpenChange, job, allowedUnitIds }: Props) {
  const qc = useQueryClient();
  const masterBenefits: string[] = Array.isArray(job?.benefits) ? job.benefits : [];
  const masterResp: string[] = Array.isArray(job?.responsibilities) ? job.responsibilities : [];
  const masterReq: string[] = Array.isArray(job?.requirements) ? job.requirements : [];

  const { data: unitJobsRows, isLoading } = useQuery({
    enabled: open && !!job?.id && allowedUnitIds.length > 0,
    queryKey: ["unit_jobs_for_override", job?.id, allowedUnitIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("id, unit_id, benefits_override, responsibilities_override, requirements_override, units(id, name, city, state)")
        .eq("job_id", job.id)
        .in("unit_id", allowedUnitIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [selBenefits, setSelBenefits] = useState<string[]>([]);
  const [selResp, setSelResp] = useState<string[]>([]);
  const [selReq, setSelReq] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !unitJobsRows) return;
    setSelBenefits(unionSelected(unitJobsRows, "benefits_override", masterBenefits));
    setSelResp(unionSelected(unitJobsRows, "responsibilities_override", masterResp));
    setSelReq(unionSelected(unitJobsRows, "requirements_override", masterReq));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unitJobsRows]);

  const hasAnyMaster = masterBenefits.length + masterResp.length + masterReq.length > 0;
  const targetCount = unitJobsRows?.length ?? 0;

  const handleSave = async () => {
    if (!unitJobsRows?.length) {
      toast.info("Você não possui vagas deste cargo nas suas unidades autorizadas.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        benefits_override: arraysEqual(selBenefits, masterBenefits)
          ? null
          : selBenefits.filter((x) => masterBenefits.includes(x)),
        responsibilities_override: arraysEqual(selResp, masterResp)
          ? null
          : selResp.filter((x) => masterResp.includes(x)),
        requirements_override: arraysEqual(selReq, masterReq)
          ? null
          : selReq.filter((x) => masterReq.includes(x)),
      };
      let okCount = 0;
      const errors: string[] = [];
      for (const row of unitJobsRows) {
        const { error } = await supabase
          .from("unit_jobs")
          .update(payload)
          .eq("id", row.id);
        if (error) errors.push(`${(row as any).units?.name ?? row.unit_id}: ${error.message}`);
        else okCount++;
      }
      if (okCount > 0) toast.success(`Personalização aplicada em ${okCount} vaga(s).`);
      if (errors.length) toast.error(`Falha em ${errors.length}: ${errors[0]}`);
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["unit_jobs_for_override"] });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Personalizar Cargo para minhas unidades</DialogTitle>
        </DialogHeader>

        {!job ? null : (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span>
                Você só pode <strong>marcar/desmarcar</strong> itens já cadastrados pela Sede em
                {" "}<strong>Benefícios</strong>, <strong>Responsabilidades</strong> e <strong>Requisitos</strong>.
                Não é possível adicionar nem excluir itens. As marcações serão aplicadas a
                {" "}<strong>{targetCount}</strong> vaga(s) do cargo <strong>{job.title}</strong>
                {" "}nas suas unidades autorizadas.
              </span>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !hasAnyMaster ? (
              <p className="text-sm text-muted-foreground">
                Este cargo ainda não possui itens institucionais para personalizar.
              </p>
            ) : targetCount === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma vaga deste cargo está aberta nas suas unidades autorizadas.
              </p>
            ) : (
              <div className="space-y-5">
                <UnitJobInheritedSelector
                  title="Benefícios"
                  inherited={masterBenefits}
                  selected={selBenefits}
                  canEdit={true}
                  onChange={setSelBenefits}
                  icon="badge"
                />
                <UnitJobInheritedSelector
                  title="Responsabilidades"
                  inherited={masterResp}
                  selected={selResp}
                  canEdit={true}
                  onChange={setSelResp}
                  icon="list"
                />
                <UnitJobInheritedSelector
                  title="Requisitos"
                  inherited={masterReq}
                  selected={selReq}
                  canEdit={true}
                  onChange={setSelReq}
                  icon="list"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || isLoading || targetCount === 0 || !hasAnyMaster}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar para minhas unidades
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
