import { useState } from "react";
import { useFeatureFlags, useToggleFeatureFlag, useUpdateFeatureFlag, useFeatureActivationLogs } from "@/hooks/useFeatureFlags";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Settings2, History, Shield, AlertTriangle, Brain, FileText, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { humanizeError } from "@/lib/userMessages";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";

const MODULE_LABELS: Record<string, string> = {
  ai_voice_interview: "Entrevista por IA (voz)",
  human_interview: "Entrevista presencial",
  career_plan: "Plano de carreira",
  mass_messaging: "Disparos em massa",
  talent_pool: "Banco de talentos",
  automated_evaluation: "Avaliação automatizada",
  smart_scheduling: "Agenda inteligente",
  auto_notifications: "Notificações automáticas",
};

const ENV_BADGE: Record<string, { label: string; variant: "destructive" | "secondary" | "outline" }> = {
  production: { label: "Produção", variant: "destructive" },
  staging: { label: "Staging", variant: "secondary" },
  development: { label: "Dev", variant: "outline" },
};

export function FeatureFlagsTab() {
  const [envFilter, setEnvFilter] = useState<string>("production");
  const { data: flags, isLoading } = useFeatureFlags(envFilter);
  const { data: controlSettings, isLoading: loadingControl } = useGlobalSettings("feature_control");
  const { data: logs, isLoading: loadingLogs } = useFeatureActivationLogs();
  const toggleFlag = useToggleFeatureFlag();
  const updateFlag = useUpdateFeatureFlag();
  const updateSetting = useUpdateSetting();
  const { toast } = useToast();

  // Confirmation state
  const [confirm, setConfirm] = useState<{
    flag: any;
    newStatus: boolean;
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [responsibilityChecked, setResponsibilityChecked] = useState(false);

  // Rollout dialog
  const [rolloutFlag, setRolloutFlag] = useState<any | null>(null);
  const [rolloutStrategy, setRolloutStrategy] = useState("total");
  const [rolloutConfig, setRolloutConfig] = useState("{}");

  // Kill switch confirm
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);

  // AI analysis state
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ action: string; result: any } | null>(null);

  const invokeAIAnalysis = async (action: string, context?: any) => {
    setAiLoading(action);
    try {
      const { data, error } = await supabase.functions.invoke("feature-flag-ai-analysis", {
        body: { action, context },
      });
      if (error) throw error;
      setAiResult({ action, result: data?.result || data });
    } catch (err: any) {
      toast({ title: "Análise indisponível", description: humanizeError(err, "feature-flag-ai"), variant: "destructive" });
    } finally {
      setAiLoading(null);
    }
  };

  const getControlValue = (key: string) => {
    const s = controlSettings?.find((s) => s.key === key);
    if (s?.value === true || s?.value === "true") return true;
    if (s?.value === false || s?.value === "false") return false;
    return s?.value;
  };

  // Environment lock
  const environmentLocked = getControlValue("environment_lock") === true && envFilter === "production";

  const requireDoubleConfirm = getControlValue("require_double_confirmation_prod") === true;

  const handleToggle = (flag: any, newStatus: boolean) => {
    if (flag.environment === "production" && requireDoubleConfirm) {
      setConfirm({ flag, newStatus });
      setStep(1);
      setConfirmText("");
      setResponsibilityChecked(false);
    } else {
      toggleFlag.mutate({
        id: flag.id,
        module_name: flag.module_name,
        environment: flag.environment,
        currentStatus: flag.enabled,
        newStatus,
      });
    }
  };

  const handleConfirmStep1 = () => setStep(2);
  const handleConfirmStep2 = () => setStep(3);
  const handleConfirmStep3 = () => setStep(4);

  const handleConfirmStep2Final = () => {
    if (confirm && confirmText === confirm.flag.module_name) {
      toggleFlag.mutate({
        id: confirm.flag.id,
        module_name: confirm.flag.module_name,
        environment: confirm.flag.environment,
        currentStatus: confirm.flag.enabled,
        newStatus: confirm.newStatus,
      });
      setConfirm(null);
      setConfirmText("");
      setStep(1);
      setResponsibilityChecked(false);
    }
  };

  const openRolloutDialog = (flag: any) => {
    setRolloutFlag(flag);
    setRolloutStrategy(flag.rollout_strategy || "total");
    setRolloutConfig(JSON.stringify(flag.rollout_config || {}, null, 2));
  };

  const saveRollout = () => {
    if (!rolloutFlag) return;
    try {
      const parsed = JSON.parse(rolloutConfig);
      updateFlag.mutate({
        id: rolloutFlag.id,
        rollout_strategy: rolloutStrategy,
        rollout_config: parsed,
      });
      setRolloutFlag(null);
    } catch {
      // invalid JSON
    }
  };

  if (isLoading || loadingControl) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <Tabs defaultValue="modules" className="space-y-4">
      <TabsList>
        <TabsTrigger value="modules"><Shield className="h-4 w-4 mr-1" />Módulos</TabsTrigger>
        <TabsTrigger value="controls"><Settings2 className="h-4 w-4 mr-1" />Controles</TabsTrigger>
        <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />Histórico</TabsTrigger>
      </TabsList>

      {/* ===== MODULES TAB ===== */}
      <TabsContent value="modules" className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <Label>Ambiente:</Label>
            <Select value={envFilter} onValueChange={setEnvFilter}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="production">Produção</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="development">Development</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!aiLoading}
              onClick={() => invokeAIAnalysis("generate_module_usage_report", { period: "último mês" })}
            >
              {aiLoading === "generate_module_usage_report" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
              Relatório de uso
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!aiLoading}
              onClick={() => invokeAIAnalysis("suggest_gradual_rollout")}
            >
              {aiLoading === "suggest_gradual_rollout" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Lightbulb className="h-4 w-4 mr-1" />}
              Sugerir rollout
            </Button>
          </div>
        </div>

        {environmentLocked && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Ambiente de produção bloqueado (environment_lock ativo). Alterações desabilitadas.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Feature Flags — {ENV_BADGE[envFilter]?.label || envFilter}</CardTitle>
            <CardDescription>Ative ou desative módulos do sistema. Alterações em produção exigem confirmação dupla.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Módulo</TableHead>
                  <TableHead>Ambiente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Estratégia</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags?.map((flag) => {
                  const env = ENV_BADGE[flag.environment] || { label: flag.environment, variant: "outline" as const };
                  return (
                    <TableRow key={flag.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{MODULE_LABELS[flag.module_name] || flag.module_name}</p>
                          {flag.description && <p className="text-xs text-muted-foreground">{flag.description}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={env.variant}>{env.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={flag.enabled}
                          disabled={environmentLocked}
                          onCheckedChange={(v) => handleToggle(flag, v)}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{flag.rollout_strategy}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openRolloutDialog(flag)}>
                            <Settings2 className="h-4 w-4 mr-1" />Rollout
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!aiLoading}
                            onClick={() => invokeAIAnalysis("evaluate_activation_impact", {
                              module_key: flag.module_name,
                              new_state: !flag.enabled,
                              previous_state: flag.enabled,
                            })}
                          >
                            {aiLoading === "evaluate_activation_impact" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!flags || flags.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Nenhuma flag encontrada para este ambiente.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== CONTROLS TAB ===== */}
      <TabsContent value="controls" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Controles Globais de Feature Flags</CardTitle>
            <CardDescription>Configurações que governam o sistema de flags.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label>Feature Control Habilitado</Label>
                <p className="text-xs text-muted-foreground">Kill switch global do sistema de flags</p>
              </div>
              <Switch
                checked={getControlValue("feature_control_enabled") === true}
                onCheckedChange={(v) => {
                  if (v === false) {
                    setKillSwitchConfirm(true);
                  } else {
                    updateSetting.mutate({ category: "feature_control", key: "feature_control_enabled", value: v });
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label>Confirmação dupla em produção</Label>
                <p className="text-xs text-muted-foreground">Exige digitação do nome do módulo para confirmar</p>
              </div>
              <Switch
                checked={getControlValue("require_double_confirmation_prod") === true}
                onCheckedChange={(v) => updateSetting.mutate({ category: "feature_control", key: "require_double_confirmation_prod", value: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label>Permitir rollout gradual</Label>
                <p className="text-xs text-muted-foreground">Habilita estratégias de rollout por unidade/região</p>
              </div>
              <Switch
                checked={getControlValue("allow_gradual_rollout") === true}
                onCheckedChange={(v) => updateSetting.mutate({ category: "feature_control", key: "allow_gradual_rollout", value: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label>Ambiente padrão</Label>
                <p className="text-xs text-muted-foreground">Ambiente usado por padrão nas consultas</p>
              </div>
              <Select
                value={String(getControlValue("default_environment") || "production")}
                onValueChange={(v) => updateSetting.mutate({ category: "feature_control", key: "default_environment", value: v })}
              >
                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Produção</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="development">Development</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label>Retenção de logs (dias)</Label>
                <p className="text-xs text-muted-foreground">Tempo de armazenamento dos logs de ativação</p>
              </div>
              <Input
                type="number"
                className="w-24"
                defaultValue={Number(getControlValue("log_retention_days")) || 90}
                onBlur={(e) => updateSetting.mutate({ category: "feature_control", key: "log_retention_days", value: Number(e.target.value) })}
              />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== HISTORY TAB ===== */}
      <TabsContent value="history" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Histórico de Ativações</CardTitle>
            <CardDescription>Registro imutável de todas as alterações em feature flags.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingLogs ? (
              <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Ambiente</TableHead>
                    <TableHead>De</TableHead>
                    <TableHead>Para</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs?.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">{MODULE_LABELS[log.module_name] || log.module_name}</TableCell>
                      <TableCell>
                        <Badge variant={ENV_BADGE[log.environment]?.variant || "outline"}>
                          {ENV_BADGE[log.environment]?.label || log.environment}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.previous_status ? "default" : "secondary"}>
                          {log.previous_status ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.new_status ? "default" : "secondary"}>
                          {log.new_status ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.changed_at).toLocaleString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!logs || logs.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Nenhum registro de ativação encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== 4-STEP CONFIRMATION DIALOG ===== */}
      <AlertDialog open={!!confirm} onOpenChange={() => { setConfirm(null); setStep(1); setConfirmText(""); setResponsibilityChecked(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {step === 1 && "Etapa 1/4 — Confirmar ambiente"}
              {step === 2 && "Etapa 2/4 — Impacto da alteração"}
              {step === 3 && "Etapa 3/4 — Confirmar responsabilidade"}
              {step === 4 && "Etapa 4/4 — Confirmação de segurança"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {step === 1 && (
                  <>
                    <p>
                      Você está prestes a <strong>{confirm?.newStatus ? "ativar" : "desativar"}</strong> o módulo{" "}
                      <strong>{MODULE_LABELS[confirm?.flag?.module_name] || confirm?.flag?.module_name}</strong> no ambiente{" "}
                      <Badge variant="destructive">Produção</Badge>.
                    </p>
                    <p className="text-sm text-muted-foreground">Esta alteração afeta toda a rede de franquias em tempo real.</p>
                  </>
                )}
                {step === 2 && (
                  <>
                    <p className="font-medium">Impacto estimado:</p>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      <li>Módulo: <strong>{MODULE_LABELS[confirm?.flag?.module_name] || confirm?.flag?.module_name}</strong></li>
                      <li>Ação: {confirm?.newStatus ? "Ativar" : "Desativar"} em produção</li>
                      <li>Estratégia de rollout atual: <Badge variant="outline">{confirm?.flag?.rollout_strategy || "total"}</Badge></li>
                      <li>Automações vinculadas serão {confirm?.newStatus ? "liberadas" : "pausadas automaticamente"}</li>
                      <li>Edge Functions vinculadas serão {confirm?.newStatus ? "desbloqueadas" : "bloqueadas (retornarão 403)"}</li>
                    </ul>
                  </>
                )}
                {step === 3 && (
                  <div className="space-y-3">
                    <p className="text-sm">Ao prosseguir, você confirma que:</p>
                    <div className="flex items-start space-x-2">
                      <Checkbox
                        id="responsibility"
                        checked={responsibilityChecked}
                        onCheckedChange={(v) => setResponsibilityChecked(v === true)}
                      />
                      <label htmlFor="responsibility" className="text-sm leading-tight cursor-pointer">
                        Eu compreendo o impacto desta alteração e assumo a responsabilidade pela {confirm?.newStatus ? "ativação" : "desativação"} deste módulo em ambiente de produção.
                      </label>
                    </div>
                  </div>
                )}
                {step === 4 && (
                  <>
                    <p>Para confirmar, digite o nome técnico do módulo: <strong>{confirm?.flag?.module_name}</strong></p>
                    <Input
                      className="mt-2"
                      placeholder={confirm?.flag?.module_name}
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                    />
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {step === 1 && (
              <Button type="button" onClick={handleConfirmStep1}>Continuar</Button>
            )}
            {step === 2 && (
              <Button type="button" onClick={handleConfirmStep2}>Entendi o impacto</Button>
            )}
            {step === 3 && (
              <Button type="button" onClick={handleConfirmStep3} disabled={!responsibilityChecked}>
                Confirmar responsabilidade
              </Button>
            )}
            {step === 4 && (
              <Button
                type="button"
                onClick={handleConfirmStep2Final}
                disabled={confirmText !== confirm?.flag?.module_name}
              >
                Confirmar alteração
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== ROLLOUT DIALOG ===== */}
      <Dialog open={!!rolloutFlag} onOpenChange={() => setRolloutFlag(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configurar Rollout — {MODULE_LABELS[rolloutFlag?.module_name] || rolloutFlag?.module_name}</DialogTitle>
            <DialogDescription>Defina a estratégia de rollout para este módulo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Estratégia</Label>
              <Select value={rolloutStrategy} onValueChange={(v) => {
                setRolloutStrategy(v);
                if (v === "total") setRolloutConfig("{}");
                else if (v === "gradual") {
                  try { const c = JSON.parse(rolloutConfig); setRolloutConfig(JSON.stringify({ ...c, percentage: c.percentage ?? 50 }, null, 2)); } catch { setRolloutConfig('{"percentage": 50}'); }
                } else if (v === "regional") {
                  try { const c = JSON.parse(rolloutConfig); setRolloutConfig(JSON.stringify({ ...c, unit_ids: c.unit_ids ?? [] }, null, 2)); } catch { setRolloutConfig('{"unit_ids": []}'); }
                }
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Total (todos)</SelectItem>
                  <SelectItem value="gradual">Gradual (percentual)</SelectItem>
                  <SelectItem value="regional">Regional (unidades específicas)</SelectItem>
                  <SelectItem value="role_based">Por perfil (roles)</SelectItem>
                  <SelectItem value="cargo_based">Por cargo (jobs)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rolloutStrategy === "gradual" && (
              <div>
                <Label>Percentual de rollout (%)</Label>
                <Input
                  type="number" min={1} max={100}
                  defaultValue={(() => { try { return JSON.parse(rolloutConfig)?.percentage ?? 50; } catch { return 50; } })()}
                  onChange={(e) => {
                    try { const c = JSON.parse(rolloutConfig); c.percentage = Number(e.target.value); setRolloutConfig(JSON.stringify(c, null, 2)); } catch {}
                  }}
                />
              </div>
            )}

            {rolloutStrategy === "regional" && (
              <div>
                <Label>IDs das Unidades (um por linha)</Label>
                <Textarea
                  rows={4}
                  className="font-mono text-xs"
                  placeholder="Cole os UUIDs das unidades, um por linha"
                  defaultValue={(() => { try { return (JSON.parse(rolloutConfig)?.unit_ids ?? []).join("\n"); } catch { return ""; } })()}
                  onChange={(e) => {
                    const ids = e.target.value.split("\n").map(s => s.trim()).filter(Boolean);
                    try { const c = JSON.parse(rolloutConfig); c.unit_ids = ids; setRolloutConfig(JSON.stringify(c, null, 2)); } catch { setRolloutConfig(JSON.stringify({ unit_ids: ids }, null, 2)); }
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">Cole os UUIDs das unidades que receberão esta funcionalidade.</p>
              </div>
            )}

            {rolloutStrategy === "role_based" && (
              <div>
                <Label>Perfis habilitados</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin"].map((role) => {
                    const roles: string[] = (() => { try { return JSON.parse(rolloutConfig)?.roles ?? []; } catch { return []; } })();
                    const isChecked = roles.includes(role);
                    return (
                      <Badge
                        key={role}
                        variant={isChecked ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => {
                          const newRoles = isChecked ? roles.filter(r => r !== role) : [...roles, role];
                          try { const c = JSON.parse(rolloutConfig); c.roles = newRoles; setRolloutConfig(JSON.stringify(c, null, 2)); } catch { setRolloutConfig(JSON.stringify({ roles: newRoles }, null, 2)); }
                        }}
                      >
                        {role}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <Label>Configuração avançada (JSON)</Label>
              <Textarea
                rows={4}
                className="font-mono text-xs"
                value={rolloutConfig}
                onChange={(e) => setRolloutConfig(e.target.value)}
                placeholder='{"unit_ids": [], "percentage": 100, "roles": []}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolloutFlag(null)}>Cancelar</Button>
            <Button onClick={saveRollout}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== KILL SWITCH DOUBLE CONFIRM ===== */}
      <DoubleConfirmDialog
        open={killSwitchConfirm}
        onOpenChange={setKillSwitchConfirm}
        title="Desativar controle de Feature Flags"
        description="Desativar o Feature Control fará com que TODOS os módulos fiquem ativos, ignorando as flags individuais. Esta é uma ação crítica que afeta toda a rede."
        confirmWord="CONFIRMAR"
        onConfirm={() => updateSetting.mutate({ category: "feature_control", key: "feature_control_enabled", value: false })}
      />

      {/* ===== AI ANALYSIS RESULT DIALOG ===== */}
      <Dialog open={!!aiResult} onOpenChange={() => setAiResult(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              {aiResult?.action === "evaluate_activation_impact" && "Avaliação de Impacto"}
              {aiResult?.action === "generate_module_usage_report" && "Relatório de Uso de Módulos"}
              {aiResult?.action === "suggest_gradual_rollout" && "Sugestões de Rollout Gradual"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {aiResult?.result && (
              <pre className="bg-muted p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                {typeof aiResult.result === "string"
                  ? aiResult.result
                  : JSON.stringify(aiResult.result, null, 2)}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiResult(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
