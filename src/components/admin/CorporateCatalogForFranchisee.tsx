import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUnits } from "@/hooks/useUnitJobs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, CheckCircle2, Lock, Briefcase, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const CONTRACT_LABEL: Record<string, string> = {
  clt: "CLT",
  pj: "PJ",
  estagio: "Estágio",
  jovem_aprendiz: "Jovem Aprendiz",
  temporario: "Temporário",
  freelancer: "Freelancer",
};
const WORK_MODEL_LABEL: Record<string, string> = {
  presencial: "Presencial",
  remoto: "Remoto",
  hibrido: "Híbrido",
};

/**
 * Catálogo de vagas corporativas (publicadas pela Sede / franqueadora) que o
 * franqueado pode ATIVAR na unidade dele. O franqueado NÃO edita a vaga em si:
 * apenas escolhe a unidade (quando tem mais de uma) e ajusta SALÁRIO + QUANTIDADE.
 * Todo o resto (cargo, pipeline, contrato, modelo, benefícios, descrição) é
 * herdado e bloqueado.
 */
export function CorporateCatalogForFranchisee() {
  const { unitIds, hasRole } = useAuth();
  const isFranchisee = hasRole("franqueado") || hasRole("gestor_recrutamento");
  const qc = useQueryClient();
  const { data: allUnits } = useUnits();

  // Vagas da SEDE (is_franqueadora = true), abertas
  const { data: catalog, isLoading } = useQuery({
    queryKey: ["corporate_catalog_for_franchisee"],
    enabled: isFranchisee,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select(
          "id, job_id, salary, openings, work_model, contract_type, opens_at, closes_at, jobs!inner(id, title, description, is_active, benefits, sede_only), units!inner(id, name, city, state, is_franqueadora)"
        )
        .eq("status", "aberta" as any)
        .eq("units.is_franqueadora", true)
        .eq("jobs.sede_only", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // unit_jobs já existentes nas unidades do franqueado — para detectar se a vaga
  // corporativa já foi ativada (mapeado por job_id+unit_id)
  const { data: myUnitJobs } = useQuery({
    queryKey: ["my_unit_jobs_for_catalog", unitIds],
    enabled: isFranchisee && unitIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("id, job_id, unit_id, status")
        .in("unit_id", unitIds);
      if (error) throw error;
      return data || [];
    },
  });

  const myUnits = useMemo(
    () => (allUnits || []).filter((u: any) => unitIds.includes(u.id) && !u.is_franqueadora),
    [allUnits, unitIds]
  );

  const [target, setTarget] = useState<any>(null);
  const [unitChoice, setUnitChoice] = useState<string>("");
  const [salary, setSalary] = useState<string>("");
  const [openings, setOpenings] = useState<string>("1");

  function openActivate(uj: any) {
    setTarget(uj);
    setUnitChoice(myUnits.length === 1 ? myUnits[0].id : "");
    setSalary(uj.salary ? String(uj.salary) : "");
    setOpenings(uj.openings ? String(uj.openings) : "1");
  }
  function closeDialog() {
    setTarget(null);
    setUnitChoice("");
    setSalary("");
    setOpenings("1");
  }

  const activate = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("Vaga inválida");
      if (!unitChoice) throw new Error("Selecione a unidade");
      const salaryNum = Number(salary);
      const openingsNum = Number(openings);
      if (!salaryNum || salaryNum <= 0) throw new Error("Informe um salário válido");
      if (!openingsNum || openingsNum < 1) throw new Error("Informe a quantidade de vagas (≥ 1)");

      // Idempotência: já existe ativa nessa unidade?
      const existing = (myUnitJobs || []).find(
        (uj: any) =>
          uj.job_id === target.job_id &&
          uj.unit_id === unitChoice &&
          ["aberta", "pausada"].includes(uj.status)
      );
      if (existing) {
        // Atualiza salário + openings (campos permitidos)
        const { error } = await supabase
          .from("unit_jobs")
          .update({ salary: salaryNum, openings: openingsNum } as any)
          .eq("id", existing.id);
        if (error) throw error;
        return { mode: "updated" as const, id: existing.id };
      }

      // Cria nova instância herdando os demais campos da vaga corporativa
      const { data, error } = await supabase
        .from("unit_jobs")
        .insert({
          job_id: target.job_id,
          unit_id: unitChoice,
          salary: salaryNum,
          openings: openingsNum,
          work_model: target.work_model ?? "presencial",
          contract_type: target.contract_type ?? "clt",
          opens_at: target.opens_at ?? null,
          closes_at: target.closes_at ?? null,
          status: "aberta" as any,
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      // Auditoria
      const { data: userData } = await supabase.auth.getUser();
      void supabase.from("activity_logs").insert({
        user_id: userData.user?.id ?? null,
        action: "vaga_corporativa_ativada_unidade",
        module: "vagas",
        details: {
          source_unit_job_id: target.id,
          new_unit_job_id: data.id,
          job_id: target.job_id,
          unit_id: unitChoice,
          salary: salaryNum,
          openings: openingsNum,
        },
      } as any);

      return { mode: "created" as const, id: data.id };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["my_unit_jobs_for_catalog"] });
      toast.success(
        res.mode === "created"
          ? "Vaga ativada na sua unidade!"
          : "Salário e quantidade atualizados."
      );
      closeDialog();
    },
    onError: (e: any) => toast.error(e.message || "Falha ao ativar vaga"),
  });

  if (!isFranchisee) return null;
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando catálogo da Sede...
        </CardContent>
      </Card>
    );
  }
  if (!catalog || catalog.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-foreground">
          Catálogo Corporativo (Sede)
        </h2>
        <Badge variant="outline" className="text-[10px]">
          {catalog.length} disponíve{catalog.length === 1 ? "l" : "is"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Vagas publicadas pela franqueadora. Ative na sua unidade para começar a receber candidatos.
      </p>

      <div className="space-y-2">
        {catalog.map((uj: any) => {
          const activeInUnits = (myUnitJobs || []).filter(
            (m: any) =>
              m.job_id === uj.job_id &&
              ["aberta", "pausada"].includes(m.status) &&
              unitIds.includes(m.unit_id)
          );
          const alreadyActive = activeInUnits.length > 0;
          return (
            <Card
              key={uj.id}
              className="border-amber-200/60 bg-gradient-to-r from-amber-50/40 to-transparent"
            >
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building2 className="h-4 w-4 text-amber-600 shrink-0" />
                    <h3 className="font-semibold text-foreground truncate">
                      {uj.jobs?.title}
                    </h3>
                    <Badge variant="outline" className="text-[10px]">
                      {WORK_MODEL_LABEL[uj.work_model || "presencial"]}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {CONTRACT_LABEL[uj.contract_type || "clt"] || uj.contract_type}
                    </Badge>
                    {alreadyActive && (
                      <Badge className="text-[10px] gap-1 bg-emerald-100 text-emerald-700 border border-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        Ativa em {activeInUnits.length} unidade
                        {activeInUnits.length > 1 ? "s" : ""} sua{activeInUnits.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Publicada por {uj.units?.name} (Sede) — sugerido: R${" "}
                    {Number(uj.salary || 0).toLocaleString("pt-BR")} ·{" "}
                    {uj.openings || 1} vaga{(uj.openings || 1) > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="bg-amber-500 hover:bg-amber-600 text-white text-xs"
                    onClick={() => openActivate(uj)}
                    disabled={myUnits.length === 0}
                    title={
                      myUnits.length === 0
                        ? "Você não possui unidades vinculadas"
                        : alreadyActive
                        ? "Atualizar salário e quantidade"
                        : "Ativar para minha unidade"
                    }
                  >
                    <Briefcase className="h-3.5 w-3.5 mr-1" />
                    {alreadyActive ? "Ajustar / Reativar" : "Ativar para minha unidade"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Dialog ATIVAR — apenas salário + quantidade editáveis */}
      <Dialog open={!!target} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-amber-600" />
              Ativar vaga na sua unidade
            </DialogTitle>
            <DialogDescription>
              Os dados estruturais da vaga (cargo, pipeline, contrato, modelo, benefícios) são
              definidos pela Sede e <strong>não podem ser alterados</strong>. Você só ajusta o
              salário e a quantidade de vagas para a sua unidade.
            </DialogDescription>
          </DialogHeader>

          {target && (
            <div className="space-y-4">
              {/* Resumo herdado (read-only) */}
              <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  {target.jobs?.title}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {WORK_MODEL_LABEL[target.work_model || "presencial"]}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {CONTRACT_LABEL[target.contract_type || "clt"] || target.contract_type}
                  </Badge>
                  {Array.isArray(target.jobs?.benefits) &&
                    target.jobs?.benefits.slice(0, 4).map((b: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{b}</Badge>
                    ))}
                  {Array.isArray(target.jobs?.benefits) && target.jobs?.benefits.length > 4 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{target.jobs?.benefits.length - 4}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Unidade */}
              {myUnits.length > 1 ? (
                <div>
                  <Label>Unidade</Label>
                  <Select value={unitChoice} onValueChange={setUnitChoice}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha a unidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {myUnits.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name} — {u.city}/{u.state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : myUnits[0] ? (
                <div>
                  <Label className="text-muted-foreground text-xs">Unidade</Label>
                  <p className="text-sm font-medium">
                    {myUnits[0].name} — {myUnits[0].city}/{myUnits[0].state}
                  </p>
                </div>
              ) : null}

              {/* Salário + Quantidade — únicos campos editáveis */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Salário (R$) *</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    placeholder="Ex: 1800"
                  />
                </div>
                <div>
                  <Label>Quantidade de vagas *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={openings}
                    onChange={(e) => setOpenings(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-white"
              disabled={activate.isPending}
              onClick={() => activate.mutate()}
            >
              {activate.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Ativar vaga
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
