import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AutomationRuleBuilder } from "@/components/admin/settings/AutomationRuleBuilder";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import {
  useAutomationRules,
  useAutomationLogs,
  useCreateAutomationRule,
  useUpdateAutomationRule,
  useToggleAutomationRule,
  useDeleteAutomationRule,
  AutomationRule,
} from "@/hooks/useAutomationRules";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Zap, Plus, Pencil, Trash2, CheckCircle2, XCircle, RotateCw } from "lucide-react";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";

const EVENT_OPTIONS = [
  { value: "candidate_approved", label: "Candidato aprovado" },
  { value: "new_job_opened", label: "Nova vaga aberta" },
  { value: "document_pending", label: "Documento pendente" },
  { value: "score_below_minimum", label: "Score abaixo do mínimo" },
  { value: "interview_scheduled", label: "Entrevista agendada" },
  { value: "interview_rescheduled", label: "Entrevista remarcada" },
  { value: "no_show_detected", label: "Não comparecimento detectado" },
  { value: "process_closed", label: "Processo encerrado" },
  { value: "hiring_completed", label: "Contratação concluída" },
];

const ACTION_OPTIONS = [
  { value: "open_calendar", label: "Abrir agenda" },
  { value: "notify_talent_pool", label: "Notificar banco de talentos" },
  { value: "send_reminder", label: "Enviar lembrete" },
  { value: "send_notification", label: "Enviar notificação" },
  { value: "suggest_content", label: "Sugerir conteúdo" },
  { value: "block_progression", label: "Bloquear progressão" },
  { value: "create_task", label: "Criar tarefa" },
  { value: "trigger_ai_analysis", label: "Disparar análise IA" },
];

const getLabel = (opts: { value: string; label: string }[], val: string) =>
  opts.find((o) => o.value === val)?.label ?? val;

const RESULT_ICONS: Record<string, React.ReactNode> = {
  sucesso: <CheckCircle2 className="h-4 w-4 text-primary" />,
  falha: <XCircle className="h-4 w-4 text-destructive" />,
  retry: <RotateCw className="h-4 w-4 text-muted-foreground" />,
};

type ActionPayloadForm = {
  title: string;
  body: string;
  channel: string;
  action_url: string;
};

type RuleForm = {
  event_name: string;
  action_type: string;
  priority: number;
  description: string;
  condition_json: string;
  is_active: boolean;
  action_payload: ActionPayloadForm;
};

const emptyForm: RuleForm = {
  event_name: "",
  action_type: "",
  priority: 0,
  description: "",
  condition_json: "{}",
  is_active: true,
  action_payload: { title: "", body: "", channel: "push", action_url: "" },
};

const NOTIF_ACTIONS = ["send_notification", "send_reminder"];

function RuleVersionsTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["automation_rule_versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_rule_versions" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  if (isLoading) return <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground py-4">Nenhuma versão registrada. Versões são criadas automaticamente ao editar regras.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Regra</TableHead>
          <TableHead>Versão</TableHead>
          <TableHead>Evento</TableHead>
          <TableHead>Ação</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Data</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((v: any) => (
          <TableRow key={v.id}>
            <TableCell className="font-mono text-xs max-w-[120px] truncate">{v.rule_id?.slice(0, 8)}</TableCell>
            <TableCell><Badge variant="secondary">v{v.version_number}</Badge></TableCell>
            <TableCell>{getLabel(EVENT_OPTIONS, v.event_name)}</TableCell>
            <TableCell>{getLabel(ACTION_OPTIONS, v.action_type)}</TableCell>
            <TableCell><Badge variant={v.is_active ? "default" : "outline"}>{v.is_active ? "Ativo" : "Inativo"}</Badge></TableCell>
            <TableCell className="text-xs">{new Date(v.created_at).toLocaleString("pt-BR")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function AutomationRulesTab() {
  const { data: settings, isLoading: loadingSettings } = useGlobalSettings("automations");
  const updateSetting = useUpdateSetting();
  const { data: rules = [], isLoading: loadingRules } = useAutomationRules();
  const [logFilterRuleId, setLogFilterRuleId] = useState<string | undefined>(undefined);
  const { data: logs = [], isLoading: loadingLogs } = useAutomationLogs(logFilterRuleId);
  const createRule = useCreateAutomationRule();
  const updateRule = useUpdateAutomationRule();
  const toggleRule = useToggleAutomationRule();
  const deleteRule = useDeleteAutomationRule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [killSwitchConfirmOpen, setKillSwitchConfirmOpen] = useState(false);

  const getSetting = (key: string) => {
    const s = settings?.find((s) => s.key === key);
    return s?.value;
  };

  const handleToggleSetting = (key: string, current: any) => {
    updateSetting.mutate({ category: "automations", key, value: !current });
  };

  const handleNumberSetting = (key: string, val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num)) updateSetting.mutate({ category: "automations", key, value: num });
  };

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (rule: AutomationRule) => {
    setEditId(rule.id);
    const ap = (rule.action_payload || {}) as any;
    setForm({
      event_name: rule.event_name,
      action_type: rule.action_type,
      priority: rule.priority,
      description: rule.description || "",
      condition_json: JSON.stringify(rule.condition_json || {}, null, 2),
      is_active: rule.is_active,
      action_payload: {
        title: ap.title || "",
        body: ap.body || "",
        channel: ap.channel || "push",
        action_url: ap.action_url || "",
      },
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    let condJson: Record<string, any> = {};
    try { condJson = JSON.parse(form.condition_json); } catch {}

    const actionPayload: Record<string, any> = {};
    if (NOTIF_ACTIONS.includes(form.action_type)) {
      if (form.action_payload.title) actionPayload.title = form.action_payload.title;
      if (form.action_payload.body) actionPayload.body = form.action_payload.body;
      if (form.action_payload.channel) actionPayload.channel = form.action_payload.channel;
      if (form.action_payload.action_url) actionPayload.action_url = form.action_payload.action_url;
    }

    const payload = {
      event_name: form.event_name,
      action_type: form.action_type,
      priority: form.priority,
      description: form.description,
      condition_json: condJson,
      action_payload: actionPayload,
      is_active: form.is_active,
    };

    if (editId) {
      updateRule.mutate({ id: editId, ...payload }, { onSuccess: () => setDialogOpen(false) });
    } else {
      createRule.mutate(payload, { onSuccess: () => setDialogOpen(false) });
    }
  };

  if (loadingSettings || loadingRules)
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const automationEnabled = getSetting("automation_enabled");

  return (
    <div className="space-y-6">
      {/* Controles Globais */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" /> Controles Globais</CardTitle>
          <CardDescription>Kill switch e parâmetros gerais do motor de automação.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <Label>Motor de Automação (Kill Switch)</Label>
            <Switch checked={!!automationEnabled} onCheckedChange={() => setKillSwitchConfirmOpen(true)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <Label>Permitir IA em Automações</Label>
            <Switch checked={!!getSetting("allow_ai_in_automation")} onCheckedChange={() => handleToggleSetting("allow_ai_in_automation", getSetting("allow_ai_in_automation"))} />
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <Label className="whitespace-nowrap">Max Retries</Label>
            <Input
              type="number" min={0} max={10}
              defaultValue={String(getSetting("max_automation_retries") ?? 3)}
              onBlur={(e) => handleNumberSetting("max_automation_retries", e.target.value)}
              className="w-20"
            />
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <Label className="whitespace-nowrap">Timeout (s)</Label>
            <Input
              type="number" min={5} max={120}
              defaultValue={String(getSetting("automation_timeout_seconds") ?? 30)}
              onBlur={(e) => handleNumberSetting("automation_timeout_seconds", e.target.value)}
              className="w-20"
            />
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <Label className="whitespace-nowrap">Retenção de Logs (dias)</Label>
            <Input
              type="number" min={7} max={365}
              defaultValue={String(getSetting("automation_log_retention_days") ?? 90)}
              onBlur={(e) => handleNumberSetting("automation_log_retention_days", e.target.value)}
              className="w-20"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Regras e Histórico */}
      <Tabs defaultValue="rules" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rules">Regras ({rules.length})</TabsTrigger>
          <TabsTrigger value="versions">Versões</TabsTrigger>
          <TabsTrigger value="logs">Histórico ({logs.length})</TabsTrigger>
        </TabsList>

        {/* Regras */}
        <TabsContent value="rules">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Regras de Automação</CardTitle>
                <CardDescription>Gerencie gatilhos evento → ação com prioridade e condições.</CardDescription>
              </div>
              <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Regra</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Badge variant="outline">{getLabel(EVENT_OPTIONS, rule.event_name)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge>{getLabel(ACTION_OPTIONS, rule.action_type)}</Badge>
                      </TableCell>
                      <TableCell>{rule.priority}</TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.is_active}
                          onCheckedChange={(v) => toggleRule.mutate({ id: rule.id, is_active: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(rule)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteRule.mutate(rule.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rules.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma regra configurada.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Versões de Regras */}
        <TabsContent value="versions">
          <Card>
            <CardHeader>
              <CardTitle>Versionamento de Regras</CardTitle>
              <CardDescription>Histórico de todas as alterações em regras de automação. Cada edição gera uma versão imutável.</CardDescription>
            </CardHeader>
            <CardContent>
              <RuleVersionsTable />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Histórico de Execução</CardTitle>
                  <CardDescription>Últimas 200 execuções de automações.</CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  {/* Summary counters */}
                  {!loadingLogs && logs.length > 0 && (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-primary" />{logs.filter(l => l.action_result === "sucesso").length}</span>
                      <span className="flex items-center gap-1"><XCircle className="h-4 w-4 text-destructive" />{logs.filter(l => l.action_result === "falha").length}</span>
                    </div>
                  )}
                  {/* Filter by rule */}
                  <Select value={logFilterRuleId || "all"} onValueChange={(v) => setLogFilterRuleId(v === "all" ? undefined : v)}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filtrar por regra" /></SelectTrigger>
                    <SelectContent disableSearch>
                      <SelectItem value="all">Todas as regras</SelectItem>
                      {rules.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.description || `${getLabel(EVENT_OPTIONS, r.event_name)} → ${getLabel(ACTION_OPTIONS, r.action_type)}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingLogs ? (
                <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Evento</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead>Tempo (ms)</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{getLabel(EVENT_OPTIONS, log.event_name)}</TableCell>
                        <TableCell>{getLabel(ACTION_OPTIONS, log.action_type)}</TableCell>
                        <TableCell className="flex items-center gap-1">
                          {RESULT_ICONS[log.action_result] ?? null}
                          {log.action_result}
                          {log.error_message && (
                            <span className="text-xs text-muted-foreground ml-1" title={log.error_message}>⚠</span>
                          )}
                        </TableCell>
                        <TableCell>{log.execution_time_ms ?? "—"}</TableCell>
                        <TableCell className="text-xs">{new Date(log.executed_at).toLocaleString("pt-BR")}</TableCell>
                      </TableRow>
                    ))}
                    {logs.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma execução registrada.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Criar/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Regra" : "Nova Regra de Automação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Evento</Label>
              <Select value={form.event_name} onValueChange={(v) => setForm({ ...form, event_name: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione o evento" /></SelectTrigger>
                <SelectContent>
                  {EVENT_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ação</Label>
              <Select value={form.action_type} onValueChange={(v) => setForm({ ...form, action_type: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione a ação" /></SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Prioridade</Label>
                <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="flex items-end gap-2">
                <Label>Ativa</Label>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição da regra" />
            </div>
            <div>
              <Label>Condições</Label>
              <AutomationRuleBuilder
                value={form.condition_json}
                onChange={(json) => setForm({ ...form, condition_json: json })}
              />
            </div>
            {NOTIF_ACTIONS.includes(form.action_type) && (
              <div className="space-y-3 rounded-lg border p-3">
                <Label className="text-xs font-semibold text-muted-foreground">Payload da Notificação</Label>
                <div>
                  <Label className="text-xs">Título</Label>
                  <Input value={form.action_payload.title} onChange={(e) => setForm({ ...form, action_payload: { ...form.action_payload, title: e.target.value } })} placeholder="Lembrete automático" />
                </div>
                <div>
                  <Label className="text-xs">Mensagem</Label>
                  <Textarea value={form.action_payload.body} onChange={(e) => setForm({ ...form, action_payload: { ...form.action_payload, body: e.target.value } })} rows={2} placeholder="Você tem uma pendência..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Canal</Label>
                    <Select value={form.action_payload.channel} onValueChange={(v) => setForm({ ...form, action_payload: { ...form.action_payload, channel: v } })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="push">Push</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">URL de Ação</Label>
                    <Input value={form.action_payload.action_url} onChange={(e) => setForm({ ...form, action_payload: { ...form.action_payload, action_url: e.target.value } })} placeholder="/notificacoes" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.event_name || !form.action_type}>
              {editId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DoubleConfirmDialog
        open={killSwitchConfirmOpen}
        onOpenChange={setKillSwitchConfirmOpen}
        title={automationEnabled ? "Desativar Motor de Automação" : "Ativar Motor de Automação"}
        description={automationEnabled
          ? "Isso desligará TODAS as automações da rede. Nenhum gatilho será executado até reativar."
          : "Isso reativará o motor de automações para toda a rede."}
        confirmWord="CONFIRMAR"
        onConfirm={() => handleToggleSetting("automation_enabled", automationEnabled)}
      />
    </div>
  );
}
