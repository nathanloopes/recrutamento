import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useState, useEffect, useMemo } from "react";
import { Loader2, X, Plus, Eye, Check, ChevronsUpDown, Building2 } from "lucide-react";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { useUnits } from "@/hooks/useUnitJobs";

export function UnitDefaultsTab() {
  const { data: settings, isLoading } = useGlobalSettings("units");
  const updateSetting = useUpdateSetting();

  // Basic fields
  const [radius, setRadius] = useState("");
  const [careerPlan, setCareerPlan] = useState(false);
  const [docs, setDocs] = useState("");

  // Roles
  const [roles, setRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState("");
  const [language, setLanguage] = useState("pt-BR");
  const [tone, setTone] = useState("formal");

  // Career plan mandatory for
  const [mandatoryRoles, setMandatoryRoles] = useState<string[]>([]);
  const [newMandatoryRole, setNewMandatoryRole] = useState("");

  // Governance
  const [enforceDocs, setEnforceDocs] = useState(true);
  const [allowOverride, setAllowOverride] = useState(false);
  const [enforceGlobalTone, setEnforceGlobalTone] = useState(true);
  const [radiusMinLimit, setRadiusMinLimit] = useState("5");
  const [allowManualCreate, setAllowManualCreate] = useState(false);
  const [overrideUnits, setOverrideUnits] = useState<string[]>([]);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

  const { data: allUnits } = useUnits();
  const franchiseeUnits = useMemo(
    () => (allUnits ?? []).filter((u: any) => !u.is_franqueadora),
    [allUnits],
  );
  const unitNameById = useMemo(() => {
    const m = new Map<string, string>();
    (allUnits ?? []).forEach((u: any) => m.set(u.id, `${u.name} — ${u.city}/${u.state}`));
    return m;
  }, [allUnits]);

  // DoubleConfirm dialogs
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [confirmEnforceDocs, setConfirmEnforceDocs] = useState(false);
  const [pendingOverrideValue, setPendingOverrideValue] = useState(false);
  const [pendingEnforceDocsValue, setPendingEnforceDocsValue] = useState(true);

  // Simulator
  const [showSimulator, setShowSimulator] = useState(false);

  useEffect(() => {
    if (settings) {
      const get = (k: string) => settings.find((s) => s.key === k)?.value;
      setRadius(String(get("default_radius_km") ?? "30"));
      setCareerPlan(get("career_plan_enabled") === true || get("career_plan_enabled") === "true");
      const d = get("default_required_documents");
      const docNames = Array.isArray(d)
        ? (d as any[]).map((x) => (typeof x === "string" ? x : x?.name ? String(x.name) : "")).filter(Boolean)
        : [];
      setDocs(docNames.length ? docNames.join(", ") : (Array.isArray(d) ? "" : String(d ?? "")));

      const r = get("default_allowed_roles");
      setRoles(Array.isArray(r) ? r : []);

      const mr = get("career_plan_mandatory_for");
      setMandatoryRoles(Array.isArray(mr) ? mr : []);

      const lang = get("default_language");
      setLanguage(typeof lang === "string" ? lang : "pt-BR");

      const t = get("default_tone");
      setTone(typeof t === "string" ? t : "formal");

      setEnforceDocs(get("enforce_default_documents") === true || get("enforce_default_documents") === "true");
      setAllowOverride(get("allow_unit_override") === true || get("allow_unit_override") === "true");
      setEnforceGlobalTone(get("enforce_global_tone") === true || get("enforce_global_tone") === "true");
      setRadiusMinLimit(String(get("radius_min_limit") ?? "5"));
      setAllowManualCreate(get("allow_manual_unit_create") === true || get("allow_manual_unit_create") === "true");
      const ou = get("unit_override_allowed_units");
      setOverrideUnits(Array.isArray(ou) ? ou : []);
    }
  }, [settings]);

  const save = (key: string, value: any) => updateSetting.mutate({ category: "units", key, value });

  const addRole = () => {
    const trimmed = newRole.trim();
    if (trimmed && !roles.includes(trimmed)) {
      const updated = [...roles, trimmed];
      setRoles(updated);
      setNewRole("");
      save("default_allowed_roles", updated);
    }
  };

  const removeRole = (role: string) => {
    const updated = roles.filter((r) => r !== role);
    setRoles(updated);
    save("default_allowed_roles", updated);
  };

  const addMandatoryRole = () => {
    const trimmed = newMandatoryRole.trim();
    if (trimmed && !mandatoryRoles.includes(trimmed)) {
      const updated = [...mandatoryRoles, trimmed];
      setMandatoryRoles(updated);
      setNewMandatoryRole("");
      save("career_plan_mandatory_for", updated);
    }
  };

  const removeMandatoryRole = (role: string) => {
    const updated = mandatoryRoles.filter((r) => r !== role);
    setMandatoryRoles(updated);
    save("career_plan_mandatory_for", updated);
  };

  // Handlers for DoubleConfirm switches
  const handleOverrideChange = (v: boolean) => {
    setPendingOverrideValue(v);
    setConfirmOverride(true);
  };

  const handleEnforceDocsChange = (v: boolean) => {
    setPendingEnforceDocsValue(v);
    setConfirmEnforceDocs(true);
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Card 1: Configurações Básicas */}
      <Card>
        <CardHeader>
          <CardTitle>Configurações Padrão para Unidades</CardTitle>
          <CardDescription>Valores aplicados automaticamente a novas unidades franqueadas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <Label>Raio padrão de busca (km)</Label>
            <div className="flex gap-2">
              <Input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
              <Button size="sm" onClick={() => save("default_radius_km", Number(radius))}>Salvar</Button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={careerPlan} onCheckedChange={(v) => { setCareerPlan(v); save("career_plan_enabled", v); }} />
            <Label>Plano de carreira habilitado por padrão</Label>
          </div>
          <div className="space-y-1">
            <Label>Documentos obrigatórios padrão</Label>
            <p className="text-xs text-muted-foreground">Separados por vírgula</p>
            <div className="flex gap-2">
              <Input value={docs} onChange={(e) => setDocs(e.target.value)} />
              <Button size="sm" onClick={() => save("default_required_documents", docs.split(",").map((d) => d.trim()).filter(Boolean))}>Salvar</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Cargos Permitidos */}
      <Card>
        <CardHeader>
          <CardTitle>Cargos Permitidos</CardTitle>
          <CardDescription>Lista de cargos habilitados para novas unidades. Evita criação fora do padrão institucional.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {roles.map((role) => (
              <Badge key={role} variant="secondary" className="gap-1 pr-1">
                {role}
                <button onClick={() => removeRole(role)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {roles.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cargo definido</p>}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Novo cargo..."
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRole()}
              className="w-full sm:max-w-[300px]"
            />
            <Button size="sm" onClick={addRole}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 2.5: Plano de Carreira Obrigatório por Cargo */}
      <Card>
        <CardHeader>
          <CardTitle>Plano de Carreira Obrigatório</CardTitle>
          <CardDescription>Cargos para os quais o plano de carreira é obrigatório, independente da configuração da unidade.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {mandatoryRoles.map((role) => (
              <Badge key={role} variant="secondary" className="gap-1 pr-1">
                {role}
                <button onClick={() => removeMandatoryRole(role)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {mandatoryRoles.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cargo definido</p>}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Cargo obrigatório..."
              value={newMandatoryRole}
              onChange={(e) => setNewMandatoryRole(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMandatoryRole()}
              className="w-full sm:max-w-[300px]"
            />
            <Button size="sm" onClick={addMandatoryRole}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: Comunicação Institucional */}
      <Card>
        <CardHeader>
          <CardTitle>Comunicação Institucional</CardTitle>
          <CardDescription>Define idioma e tom padrão para mensagens automáticas, notificações e IA.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Idioma padrão</Label>
              <Select value={language} onValueChange={(v) => { setLanguage(v); save("default_language", v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Tom de comunicação</Label>
              <Select value={tone} onValueChange={(v) => { setTone(v); save("default_tone", v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="formal">Formal</SelectItem>
                  <SelectItem value="neutro">Neutro</SelectItem>
                  <SelectItem value="acolhedor">Acolhedor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={enforceGlobalTone} onCheckedChange={(v) => { setEnforceGlobalTone(v); save("enforce_global_tone", v); }} />
            <Label>Forçar tom institucional (impedir override por unidade)</Label>
          </div>
        </CardContent>
      </Card>

      {/* Card 4: Governança */}
      <Card>
        <CardHeader>
          <CardTitle>Governança</CardTitle>
          <CardDescription>Controles de segurança e permissão para unidades.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={enforceDocs} onCheckedChange={handleEnforceDocsChange} />
            <div>
              <Label>Documentos obrigatórios protegidos</Label>
              <p className="text-xs text-muted-foreground">Impede que unidades removam documentos da lista institucional</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={allowOverride} onCheckedChange={handleOverrideChange} />
            <div>
              <Label>Permitir personalização por unidade</Label>
              <p className="text-xs text-muted-foreground">Unidades autorizadas poderão marcar/desmarcar Benefícios, Responsabilidades e Requisitos das vagas</p>
            </div>
          </div>

          {allowOverride && (
            <div className="space-y-2 ml-12 border-l-2 border-amber-500/40 pl-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-amber-600" />
                <Label className="text-sm">Unidades autorizadas a personalizar</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Apenas as unidades selecionadas abaixo poderão personalizar suas vagas. Sem essa autorização, o switch acima não tem efeito para a unidade.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {overrideUnits.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">Nenhuma unidade autorizada ainda.</span>
                )}
                {overrideUnits.map((uid) => (
                  <Badge key={uid} variant="secondary" className="gap-1 pr-1">
                    {unitNameById.get(uid) ?? uid}
                    <button
                      onClick={() => {
                        const next = overrideUnits.filter((x) => x !== uid);
                        setOverrideUnits(next);
                        save("unit_override_allowed_units", next);
                      }}
                      className="ml-1 rounded-full hover:bg-muted p-0.5"
                      aria-label="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto justify-between">
                    Adicionar unidade…
                    <ChevronsUpDown className="h-4 w-4 ml-2 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar unidade..." />
                    <CommandList>
                      <CommandEmpty>Nenhuma unidade encontrada.</CommandEmpty>
                      <CommandGroup>
                        {franchiseeUnits.map((u: any) => {
                          const checked = overrideUnits.includes(u.id);
                          return (
                            <CommandItem
                              key={u.id}
                              value={`${u.name} ${u.city} ${u.state}`}
                              onSelect={() => {
                                const next = checked
                                  ? overrideUnits.filter((x) => x !== u.id)
                                  : [...overrideUnits, u.id];
                                setOverrideUnits(next);
                                save("unit_override_allowed_units", next);
                              }}
                            >
                              <Check className={`h-4 w-4 mr-2 ${checked ? "opacity-100" : "opacity-0"}`} />
                              <span className="flex-1">{u.name}</span>
                              <span className="text-xs text-muted-foreground">{u.city}/{u.state}</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <div className="space-y-1">
            <Label>Raio mínimo permitido (km)</Label>
            <div className="flex gap-2">
              <Input type="number" value={radiusMinLimit} onChange={(e) => setRadiusMinLimit(e.target.value)} />
              <Button size="sm" onClick={() => save("radius_min_limit", Number(radiusMinLimit))}>Salvar</Button>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t pt-4">
            <Switch
              checked={allowManualCreate}
              onCheckedChange={(v) => { setAllowManualCreate(v); save("allow_manual_unit_create", v); }}
            />
            <div>
              <Label>Permitir cadastro manual de unidades</Label>
              <p className="text-xs text-muted-foreground">
                Quando ativado, administradores podem criar unidades manualmente em "Monitoramento Territorial".
                As unidades manuais são marcadas com a origem <strong>MANUAL</strong>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 5: Simulador de Provisionamento */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Simulador de Provisionamento
          </CardTitle>
          <CardDescription>Visualize como ficaria uma nova unidade com os defaults atuais.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setShowSimulator(!showSimulator)}>
            {showSimulator ? "Ocultar simulação" : "Simular criação de unidade"}
          </Button>
          {showSimulator && (
            <div className="mt-4 rounded-lg border bg-muted/50 p-4 space-y-3">
              <h4 className="font-semibold text-sm">📋 Preview: Nova Unidade</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Raio de busca:</span>{" "}
                  <span className="font-medium">{radius} km</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Plano de carreira:</span>{" "}
                  <Badge variant={careerPlan ? "default" : "secondary"}>{careerPlan ? "Ativado" : "Desativado"}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Idioma:</span>{" "}
                  <span className="font-medium">{language}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tom:</span>{" "}
                  <span className="font-medium capitalize">{tone}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Override permitido:</span>{" "}
                  <Badge variant={allowOverride ? "default" : "secondary"}>{allowOverride ? "Sim" : "Não"}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Raio mínimo:</span>{" "}
                  <span className="font-medium">{radiusMinLimit} km</span>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Documentos obrigatórios:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {docs.split(",").map((d) => d.trim()).filter(Boolean).map((doc) => (
                    <Badge key={doc} variant="outline" className="text-xs">{doc}</Badge>
                  ))}
                  {!docs.trim() && <span className="text-xs text-muted-foreground">Nenhum definido</span>}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Cargos permitidos:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {roles.map((role) => (
                    <Badge key={role} variant="outline" className="text-xs">{role}</Badge>
                  ))}
                  {roles.length === 0 && <span className="text-xs text-muted-foreground">Nenhum definido</span>}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Plano de carreira obrigatório para:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {mandatoryRoles.map((role) => (
                    <Badge key={role} variant="outline" className="text-xs">{role}</Badge>
                  ))}
                  {mandatoryRoles.length === 0 && <span className="text-xs text-muted-foreground">Nenhum definido</span>}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DoubleConfirm Dialogs */}
      <DoubleConfirmDialog
        open={confirmOverride}
        onOpenChange={setConfirmOverride}
        title="Alterar permissão de override"
        description={pendingOverrideValue
          ? "Ao ativar, todas as unidades poderão personalizar configurações herdadas. Isso pode gerar inconsistências operacionais."
          : "Ao desativar, as unidades perderão a capacidade de personalizar suas configurações. Alterações locais existentes serão mantidas, mas não poderão ser editadas."
        }
        skipTextConfirm
        confirmLabel="Confirmar alteração"
        onConfirm={() => {
          setAllowOverride(pendingOverrideValue);
          save("allow_unit_override", pendingOverrideValue);
        }}
      />

      <DoubleConfirmDialog
        open={confirmEnforceDocs}
        onOpenChange={setConfirmEnforceDocs}
        title="Alterar proteção de documentos"
        description={pendingEnforceDocsValue
          ? "Ao ativar, as unidades não poderão remover documentos obrigatórios da lista institucional."
          : "Ao desativar, as unidades poderão remover documentos da lista institucional. Isso pode gerar riscos de compliance."
        }
        skipTextConfirm
        confirmLabel="Confirmar alteração"
        onConfirm={() => {
          setEnforceDocs(pendingEnforceDocsValue);
          save("enforce_default_documents", pendingEnforceDocsValue);
        }}
      />
    </div>
  );
}
