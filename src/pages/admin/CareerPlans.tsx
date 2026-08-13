import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, TrendingUp } from "lucide-react";
import { useCareerPlans, useCreateCareerPlan, useUpdateCareerPlan } from "@/hooks/useCareerPlans";
import { useUnits } from "@/hooks/useUnitJobs";
import { useJobs } from "@/hooks/useJobs";
import { toast } from "sonner";
import { PageHelp } from "@/components/ui/page-help";

interface CareerLevel {
  name: string;
  salary_range: string;
  criteria: string;
}

export default function CareerPlans() {
  const [filterUnit, setFilterUnit] = useState<string>("all");
  const [filterJob, setFilterJob] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ unit_id: "", job_id: "", is_active: true });
  const [levels, setLevels] = useState<CareerLevel[]>([
    { name: "Júnior", salary_range: "", criteria: "" },
  ]);

  const { data: plans, isLoading } = useCareerPlans(
    filterUnit !== "all" ? filterUnit : undefined,
    filterJob !== "all" ? filterJob : undefined
  );
  const { data: units } = useUnits();
  const { data: jobs } = useJobs(true);
  const createPlan = useCreateCareerPlan();
  const updatePlan = useUpdateCareerPlan();

  const addLevel = () => setLevels([...levels, { name: "", salary_range: "", criteria: "" }]);
  const removeLevel = (i: number) => setLevels(levels.filter((_, idx) => idx !== i));
  const updateLevel = (i: number, field: keyof CareerLevel, value: string) => {
    const updated = [...levels];
    updated[i] = { ...updated[i], [field]: value };
    setLevels(updated);
  };

  const handleCreate = async () => {
    if (!form.unit_id || !form.job_id) return;
    if (levels.some((l) => !l.name)) {
      toast.error("Todos os níveis precisam de um nome");
      return;
    }
    try {
      await createPlan.mutateAsync({
        unit_id: form.unit_id,
        job_id: form.job_id,
        levels,
        is_active: form.is_active,
      });
      toast.success("Plano de carreira criado");
      setDialogOpen(false);
      setForm({ unit_id: "", job_id: "", is_active: true });
      setLevels([{ name: "Júnior", salary_range: "", criteria: "" }]);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await updatePlan.mutateAsync({ id, is_active: !current });
    toast.success("Status atualizado");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-6 w-6" /> Planos de Carreira
        </h2>
        <PageHelp />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Novo Plano</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Novo Plano de Carreira</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Unidade</Label>
                  <Select value={form.unit_id} onValueChange={(v) => setForm({ ...form, unit_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{units?.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} - {u.city}/{u.state}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cargo</Label>
                  <Select value={form.job_id} onValueChange={(v) => setForm({ ...form, job_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{jobs?.map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label>Plano ativo</Label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-base font-semibold">Níveis</Label>
                  <Button variant="outline" size="sm" onClick={addLevel}><Plus className="h-3 w-3 mr-1" />Adicionar</Button>
                </div>
                <div className="space-y-3">
                  {levels.map((level, i) => (
                    <Card key={i} className="border">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground font-medium">Nível {i + 1}</span>
                          {levels.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeLevel(i)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <Input placeholder="Nome (ex: Júnior)" value={level.name} onChange={(e) => updateLevel(i, "name", e.target.value)} />
                        <Input placeholder="Faixa salarial (ex: 1500-2000)" value={level.salary_range} onChange={(e) => updateLevel(i, "salary_range", e.target.value)} />
                        <Input placeholder="Critérios (ex: 0-6 meses)" value={level.criteria} onChange={(e) => updateLevel(i, "criteria", e.target.value)} />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <Button onClick={handleCreate} className="w-full" disabled={createPlan.isPending}>Criar Plano</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select value={filterUnit} onValueChange={setFilterUnit}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Unidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {units?.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterJob} onValueChange={setFilterJob}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Cargo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {jobs?.map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-3">
          {plans?.map((plan: any) => (
            <Card key={plan.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{plan.jobs?.title}</h3>
                    <p className="text-sm text-muted-foreground">{plan.units?.name} — {plan.units?.city}/{plan.units?.state}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={plan.is_active ? "default" : "secondary"}>
                      {plan.is_active ? "Ativo" : "Inativo"}
                    </Badge>
                    <Switch checked={plan.is_active} onCheckedChange={() => toggleActive(plan.id, plan.is_active)} />
                  </div>
                </div>
                {Array.isArray(plan.levels) && plan.levels.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nível</TableHead>
                        <TableHead>Faixa Salarial</TableHead>
                        <TableHead>Critérios</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(plan.levels as CareerLevel[]).map((level, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{level.name}</TableCell>
                          <TableCell>{level.salary_range || "—"}</TableCell>
                          <TableCell>{level.criteria || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))}
          {plans?.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum plano de carreira encontrado.</p>}
        </div>
      )}
    </div>
  );
}
