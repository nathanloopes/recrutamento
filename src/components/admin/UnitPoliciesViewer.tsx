import { useUnitPolicy, useUpdateUnitPolicy, useUnitGovernanceConfig, useUnitConfigLogs } from "@/hooks/useUnitPolicies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, Lock, Pencil, History, ShieldAlert } from "lucide-react";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface UnitPoliciesViewerProps {
  unitId: string;
  unitName?: string;
}

export function UnitPoliciesViewer({ unitId, unitName }: UnitPoliciesViewerProps) {
  const { data: policy, isLoading } = useUnitPolicy(unitId);
  const { data: gov, isLoading: loadingGov } = useUnitGovernanceConfig();
  const { data: configLogs } = useUnitConfigLogs(unitId);
  const updatePolicy = useUpdateUnitPolicy();
  const { toast } = useToast();

  const [radiusKm, setRadiusKm] = useState("");
  const [language, setLanguage] = useState("pt-BR");
  const [tone, setTone] = useState("formal");
  const [careerPlan, setCareerPlan] = useState(false);

  useEffect(() => {
    if (policy) {
      setRadiusKm(String(policy.radius_km ?? ""));
      setLanguage(policy.language ?? "pt-BR");
      setTone(policy.tone ?? "formal");
      setCareerPlan(policy.career_plan_enabled ?? false);
    }
  }, [policy]);

  if (isLoading || loadingGov) {
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!policy) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground text-center">
            Nenhuma política configurada para esta unidade. O provisionamento automático será aplicado na criação.
          </p>
        </CardContent>
      </Card>
    );
  }

  const canEdit = policy.override_allowed;
  const toneProtected = gov?.enforceGlobalTone === true;

  const saveField = (updates: Record<string, any>) => {
    updatePolicy.mutate({ unitId, updates });
  };

  const handleCareerPlanToggle = (v: boolean) => {
    // Check if career plan is mandatory for any role this unit has
    if (!v && gov?.careerPlanMandatoryFor && gov.careerPlanMandatoryFor.length > 0) {
      const unitRoles = policy.allowed_roles ?? [];
      const mandatoryMatch = gov.careerPlanMandatoryFor.filter((r: string) =>
        unitRoles.some((ur: string) => ur.toLowerCase() === r.toLowerCase())
      );
      if (mandatoryMatch.length > 0) {
        toast({
          title: "Plano de carreira obrigatório",
          description: `Não é possível desativar. Obrigatório para: ${mandatoryMatch.join(", ")}`,
          variant: "destructive",
        });
        return;
      }
    }
    setCareerPlan(v);
    saveField({ career_plan_enabled: v });
  };

  const InheritanceBadge = ({ isCustom }: { isCustom?: boolean }) => (
    <Badge variant={isCustom ? "default" : "outline"} className="text-xs gap-1">
      {isCustom ? (
        <><Pencil className="h-3 w-3" /> Personalizado</>
      ) : (
        <><Lock className="h-3 w-3" /> Padrão Institucional</>
      )}
    </Badge>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Configurações da Unidade{unitName ? `: ${unitName}` : ""}
          </CardTitle>
          <CardDescription>
            {canEdit
              ? "Esta unidade pode personalizar suas configurações."
              : "Configurações herdadas da franqueadora. Personalização não permitida."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Raio */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Raio de busca (km)</Label>
              <InheritanceBadge />
            </div>
            {canEdit ? (
              <div className="flex gap-2">
                <Input type="number" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} min={gov?.radiusMinLimit ?? 5} />
                <Button size="sm" onClick={() => saveField({ radius_km: Number(radiusKm) })}>Salvar</Button>
              </div>
            ) : (
              <p className="text-sm font-medium">{policy.radius_km} km</p>
            )}
            {canEdit && gov?.radiusMinLimit && (
              <p className="text-xs text-muted-foreground">Mínimo permitido: {gov.radiusMinLimit} km</p>
            )}
          </div>

          {/* Plano de carreira */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch checked={careerPlan} disabled={!canEdit} onCheckedChange={handleCareerPlanToggle} />
              <Label>Plano de carreira</Label>
            </div>
            <InheritanceBadge />
          </div>

          {/* Idioma — disabled if enforce_global_tone */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label>Idioma</Label>
                {toneProtected && <ShieldAlert className="h-3.5 w-3.5 text-destructive" />}
              </div>
              <InheritanceBadge />
            </div>
            {canEdit && !toneProtected ? (
              <Select value={language} onValueChange={(v) => { setLanguage(v); saveField({ language: v }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div>
                <p className="text-sm font-medium">{policy.language}</p>
                {toneProtected && <p className="text-xs text-destructive">Protegido pela franqueadora</p>}
              </div>
            )}
          </div>

          {/* Tom — disabled if enforce_global_tone */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label>Tom de comunicação</Label>
                {toneProtected && <ShieldAlert className="h-3.5 w-3.5 text-destructive" />}
              </div>
              <InheritanceBadge />
            </div>
            {canEdit && !toneProtected ? (
              <Select value={tone} onValueChange={(v) => { setTone(v); saveField({ tone: v }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="formal">Formal</SelectItem>
                  <SelectItem value="neutro">Neutro</SelectItem>
                  <SelectItem value="acolhedor">Acolhedor</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div>
                <p className="text-sm font-medium capitalize">{policy.tone}</p>
                {toneProtected && <p className="text-xs text-destructive">Protegido pela franqueadora</p>}
              </div>
            )}
          </div>

          {/* Documentos */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Documentos obrigatórios</Label>
              <InheritanceBadge />
            </div>
            <div className="flex flex-wrap gap-1">
              {(policy.required_documents ?? [])
                .map((doc: any) => (typeof doc === "string" ? doc : doc?.name ?? ""))
                .filter((name: string) => !!name)
                .map((name: string) => {
                  const isInstitutional = gov?.defaultRequiredDocuments?.includes(name);
                  return (
                    <Badge key={name} variant={isInstitutional ? "default" : "outline"} className="text-xs">
                      {isInstitutional && <Lock className="h-2.5 w-2.5 mr-1" />}
                      {name}
                    </Badge>
                  );
                })}
              {(!policy.required_documents || policy.required_documents.length === 0) && (
                <span className="text-xs text-muted-foreground">Nenhum definido</span>
              )}
            </div>
            {gov?.enforceDefaultDocuments && (
              <p className="text-xs text-muted-foreground">Documentos com 🔒 são obrigatórios e não podem ser removidos.</p>
            )}
          </div>

          {/* Cargos */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Cargos permitidos</Label>
              <InheritanceBadge />
            </div>
            <div className="flex flex-wrap gap-1">
              {(policy.allowed_roles ?? []).map((role) => (
                <Badge key={role} variant="outline" className="text-xs">{role}</Badge>
              ))}
              {(!policy.allowed_roles || policy.allowed_roles.length === 0) && (
                <span className="text-xs text-muted-foreground">Nenhum definido</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Config history */}
      {configLogs && configLogs.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="history">
            <AccordionTrigger className="text-sm font-medium">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Histórico de alterações ({configLogs.length})
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">Data</TableHead>
                    <TableHead className="h-8 text-xs">Tipo</TableHead>
                    <TableHead className="h-8 text-xs">Alterações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configLogs.slice(0, 20).map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="py-1.5 text-xs">
                        {format(new Date(log.created_at), "dd/MM/yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge variant={log.change_type === "criacao" ? "default" : "secondary"} className="text-xs">
                          {log.change_type === "criacao" ? "Criação" : "Override"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground max-w-[200px] truncate">
                        {log.change_type === "criacao"
                          ? "Provisionamento automático"
                          : summarizeChanges(log.previous_config, log.new_config)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

function summarizeChanges(prev: any, next: any): string {
  if (!prev || !next) return "Configuração atualizada";
  const changed: string[] = [];
  const keys = ["radius_km", "career_plan_enabled", "language", "tone", "required_documents", "allowed_roles"];
  for (const k of keys) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      changed.push(k.replace(/_/g, " "));
    }
  }
  return changed.length > 0 ? changed.join(", ") : "Sem alterações visíveis";
}
