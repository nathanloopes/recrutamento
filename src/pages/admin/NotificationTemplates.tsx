import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Edit, Bell, Send, XCircle, Loader2, RefreshCw, BarChart3, CalendarIcon, MessageSquare, Mail, Download, Sparkles, Activity } from "lucide-react";
import { useNotificationTemplates, useCreateTemplate, useUpdateTemplate, useDeleteTemplate } from "@/hooks/useNotifications";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationAuditMetrics, useFilteredDeliveryLogs, useReprocessNotification } from "@/hooks/useNotificationAudit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PageHelp } from "@/components/ui/page-help";
import { ChannelMonitoringTab } from "@/components/admin/notifications/ChannelMonitoringTab";
import { NotificationAuditEnhanced } from "@/components/admin/notifications/NotificationAuditEnhanced";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

import { EVENT_TYPE_LABELS } from "@/lib/notificationLabels";

const EVENT_TYPES = Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const CHANNELS = [
  { value: "push", label: "Push" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
];

const PRIORITIES = [
  { value: "alta", label: "Alta" },
  { value: "media", label: "Média" },
  { value: "baixa", label: "Baixa" },
];

const SAMPLE_VARS: Record<string, string> = {
  nome: "João Silva",
  data: "15/03/2026",
  hora: "14:00",
  cargo: "Atendente",
  unidade: "Unidade Centro",
  documento: "RG",
  motivo: "Imagem ilegível",
};

const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case "alta": return <Badge variant="destructive">Alta</Badge>;
    case "baixa": return <Badge variant="secondary">Baixa</Badge>;
    default: return <Badge variant="outline">Média</Badge>;
  }
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "draft": return <Badge variant="secondary">Rascunho</Badge>;
    case "approved": return <Badge variant="outline" className="border-primary text-primary">Aprovado</Badge>;
    case "active": return <Badge variant="default">Ativo</Badge>;
    case "archived": return <Badge variant="secondary" className="opacity-60">Arquivado</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
};

const TEMPLATE_STATUSES = [
  { value: "draft", label: "Rascunho" },
  { value: "approved", label: "Aprovado" },
  { value: "active", label: "Ativo" },
  { value: "archived", label: "Arquivado" },
];

export default function NotificationTemplates() {
  const { data: templates, isLoading } = useNotificationTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  // Audit
  const { data: auditMetrics, isLoading: auditLoading } = useNotificationAuditMetrics();

  // CrossConfig enforcement
  const { data: globalSettings } = useGlobalSettings("notifications");
  const notifSettings = useMemo(() => {
    const map: Record<string, any> = {};
    (globalSettings || []).forEach((s: any) => { map[s.key] = s.value; });
    return map;
  }, [globalSettings]);

  const allowManualReprocess = notifSettings.allow_manual_reprocess !== false && notifSettings.allow_manual_reprocess !== "false";
  const requireTemplateApproval = notifSettings.require_template_approval === true || notifSettings.require_template_approval === "true";
  const aiTemplateReviewEnabled = notifSettings.ai_template_review_enabled !== false && notifSettings.ai_template_review_enabled !== "false";
  const channelHealthMonitoring = notifSettings.channel_health_monitoring !== false && notifSettings.channel_health_monitoring !== "false";

  // Logs filters
  const [logChannel, setLogChannel] = useState("all");
  const [logStatus, setLogStatus] = useState<string>("all");
  const [logEvent, setLogEvent] = useState("all");
  const [logDateFrom, setLogDateFrom] = useState<Date | undefined>();
  const [logDateTo, setLogDateTo] = useState<Date | undefined>();

  const deliveredFilter = logStatus === "all" ? null : logStatus === "delivered" ? true : false;
  const { data: filteredLogs, isLoading: logsLoading } = useFilteredDeliveryLogs({
    channel: logChannel !== "all" ? logChannel : undefined,
    delivered: deliveredFilter !== null ? deliveredFilter : undefined,
    eventType: logEvent !== "all" ? logEvent : undefined,
    dateFrom: logDateFrom ? format(logDateFrom, "yyyy-MM-dd") : undefined,
    dateTo: logDateTo ? format(logDateTo, "yyyy-MM-dd") : undefined,
  });

  const reprocess = useReprocessNotification();

  // Template state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ event_type: "", channel: "whatsapp", title: "", body: "", is_active: true, priority: "media", status: "draft", meta_template_name: "", meta_template_language: "pt_BR", meta_variable_mapping: "" });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testDialog, setTestDialog] = useState<any>(null);
  const [testPhone, setTestPhone] = useState("");
  const [filterEvent, setFilterEvent] = useState("all");

  // Email test state
  const [emailTestDialog, setEmailTestDialog] = useState<any>(null);
  const [testEmail, setTestEmail] = useState("");

  // AI suggestion state
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ title: string; body: string } | null>(null);
  const [legalCheckLoading, setLegalCheckLoading] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm({ event_type: "", channel: "whatsapp", title: "", body: "", is_active: true, priority: "media", status: "draft", meta_template_name: "", meta_template_language: "pt_BR", meta_variable_mapping: "" });
    setDialogOpen(true);
  };

  const openEdit = (t: any) => {
    setEditingId(t.id);
    const mapping = Array.isArray(t.meta_variable_mapping) ? t.meta_variable_mapping.join("\n") : "";
    setForm({ event_type: t.event_type, channel: t.channel, title: t.title || "", body: t.body, is_active: t.is_active, priority: t.priority || "media", status: t.status || (t.is_active ? "active" : "archived"), meta_template_name: t.meta_template_name || "", meta_template_language: t.meta_template_language || "pt_BR", meta_variable_mapping: mapping });
    setDialogOpen(true);
  };


  const handleSave = async () => {
    if (!form.event_type) { toast.error("Preencha o evento"); return; }
    if (form.channel !== "whatsapp" && !form.body) { toast.error("Preencha o corpo da mensagem"); return; }
    if (form.channel === "whatsapp" && !(form as any).meta_template_name) { toast.error("Preencha o nome do template HSM da Meta"); return; }
    // Enforce: require_template_approval — block activation without prior approval
    if (requireTemplateApproval && form.status === "active") {
      if (editingId) {
        const t = (templates || []).find((t: any) => t.id === editingId);
        if (t && t.status !== "approved" && t.status !== "active") {
          toast.error("Template precisa ser aprovado antes de ser ativado.");
          return;
        }
      } else {
        toast.error("Novos templates devem passar por aprovação antes de serem ativados.");
        return;
      }
    }

    try {
      // Converte mapping multi-linha em array (apenas para WhatsApp)
      const mappingArr = form.channel === "whatsapp" && form.meta_variable_mapping
        ? form.meta_variable_mapping.split("\n").map(s => s.trim()).filter(Boolean)
        : [];
      const payload: any = {
        event_type: form.event_type,
        channel: form.channel,
        title: form.title,
        body: form.body,
        is_active: form.is_active,
        priority: form.priority,
        status: form.status,
        meta_template_name: form.channel === "whatsapp" ? (form.meta_template_name || null) : null,
        meta_template_language: form.channel === "whatsapp" ? (form.meta_template_language || "pt_BR") : null,
        meta_variable_mapping: mappingArr,
      };
      if (editingId) {
        await updateTemplate.mutateAsync({ id: editingId, ...payload });
        toast.success("Template atualizado!");
      } else {
        await createTemplate.mutateAsync(payload);
        toast.success("Template criado!");
      }
      setDialogOpen(false);


      // Verificação jurídica IA roda em background (não bloqueia o salvamento).
      // Timeout máximo de 6s — se passar, ignora silenciosamente.
      if (form.status === "active") {
        const legalCheckPromise = supabase.functions.invoke("faq-assistant", {
          body: {
            question: `Analise o seguinte template de notificação institucional e verifique se há risco jurídico, linguagem discriminatória, promessas indevidas, violação de LGPD ou tom inadequado. Responda APENAS em JSON: {"risk": true/false, "issues": ["..."], "recommendation": "..."}

Título: ${form.title}
Corpo: ${form.body}
Evento: ${form.event_type}
Canal: ${form.channel}`,
          },
        });
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 6000));
        Promise.race([legalCheckPromise, timeoutPromise])
          .then((result: any) => {
            if (result?.timeout) return;
            const { data: legalData, error: legalError } = result || {};
            if (legalError || !legalData) return;
            const answer = legalData?.answer || legalData?.response || "";
            const jsonMatch = answer.match(/\{[\s\S]*"risk"[\s\S]*\}/);
            if (!jsonMatch) return;
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.risk === true) {
                const issues = (parsed.issues || []).join("; ");
                toast.warning(
                  `⚠️ Verificação Jurídica IA: ${issues || "riscos detectados"}. ${parsed.recommendation || "Revise o template."}`,
                  { duration: 12000 }
                );
              }
            } catch { /* ignore parse errors */ }
          })
          .catch(() => { /* non-blocking */ });
      }
    } catch (e: any) { toast.error(e.message); }
  };

  const preview = form.body.replace(/\{\{(\w+)\}\}/g, (_, key) => SAMPLE_VARS[key] ?? `{{${key}}}`);
  const filtered = (templates || []).filter((t: any) => filterEvent === "all" || t.event_type === filterEvent);

  const handleTestWhatsApp = async () => {
    if (!testDialog || !testPhone) return;
    const t = testDialog;
    setTestingId(t.id);
    try {
      const rendered = t.body.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => SAMPLE_VARS[key] ?? `{{${key}}}`);
      const titleRendered = (t.title || t.event_type).replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => SAMPLE_VARS[key] ?? `{{${key}}}`);
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: {
          phone: testPhone.replace(/\D/g, ""),
          message: `*${titleRendered}*\n\n${rendered}\n\n_[TESTE - Template: ${t.event_type}]_`,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success("Mensagem de teste enviada via WhatsApp!");
        setTestDialog(null);
        setTestPhone("");
      } else {
        const reasonMap: Record<string, string> = {
          zapi_not_configured: "Secrets Z-API ausentes. Cadastre ZAPI_INSTANCE_ID, ZAPI_TOKEN e ZAPI_SECURITY_TOKEN.",
          zapi_instance_invalid: "ZAPI_INSTANCE_ID inválido. Confira no painel Z-API (Configurações da instância).",
          zapi_token_invalid: "ZAPI_TOKEN ou ZAPI_SECURITY_TOKEN (Client-Token) inválido.",
          zapi_disconnected: "Instância Z-API desconectada do WhatsApp. Reescaneie o QR Code.",
        };
        const friendly = (data?.reason && reasonMap[data.reason]) || data?.error || "Erro desconhecido";
        toast.error("Falha no envio: " + friendly, { duration: 8000 });
      }
    } catch (e: any) {
      toast.error("Erro ao testar: " + e.message);
    } finally {
      setTestingId(null);
    }
  };

  const handleTestEmail = async () => {
    if (!emailTestDialog || !testEmail) return;
    const t = emailTestDialog;
    setTestingId(t.id);
    try {
      const rendered = t.body.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => SAMPLE_VARS[key] ?? `{{${key}}}`);
      const titleRendered = (t.title || t.event_type).replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => SAMPLE_VARS[key] ?? `{{${key}}}`);
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to_email: testEmail,
          to_name: "Teste",
          subject: `[TESTE] ${titleRendered}`,
          text_content: rendered,
          html_content: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <h2 style="color:#1a1a1a">${titleRendered}</h2>
            <p style="color:#333;line-height:1.6">${rendered}</p>
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
            <p style="color:#999;font-size:12px">[TESTE - Template: ${t.event_type}]</p>
          </div>`,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success("E-mail de teste enviado!");
        setEmailTestDialog(null);
        setTestEmail("");
      } else {
        toast.error("Falha no envio: " + (data?.error || "Erro desconhecido"));
      }
    } catch (e: any) {
      toast.error("Erro ao testar: " + e.message);
    } finally {
      setTestingId(null);
    }
  };

  const handleAiSuggest = async () => {
    if (!form.event_type) { toast.error("Selecione um evento primeiro"); return; }
    setAiSuggesting(true);
    setAiSuggestion(null);
    try {
      const eventLabel = EVENT_TYPES.find(e => e.value === form.event_type)?.label || form.event_type;
      const channelLabel = form.channel === "push" ? "Push" : form.channel === "whatsapp" ? "WhatsApp" : "E-mail";
      const { data, error } = await supabase.functions.invoke("faq-assistant", {
        body: {
          question: `Gere um template de notificação institucional para o evento "${eventLabel}" no canal ${channelLabel}. O tom deve ser profissional, claro e objetivo. Use variáveis {{nome}}, {{data}}, {{hora}}, {{cargo}}, {{unidade}} quando aplicável. Responda APENAS em JSON: {"title": "...", "body": "..."}`,
        },
      });
      if (error) throw error;
      const answer = data?.answer || data?.response || "";
      // Try to parse JSON from the response
      const jsonMatch = answer.match(/\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        setAiSuggestion({ title: parsed.title || "", body: parsed.body || "" });
      } else {
        toast.error("IA não retornou formato válido. Tente novamente.");
      }
    } catch (e: any) {
      toast.error("Erro ao gerar sugestão IA: " + e.message);
    } finally {
      setAiSuggesting(false);
    }
  };

  const getHealthBadge = (rate: number) => {
    if (rate >= 90) return <Badge variant="default">Saudável</Badge>;
    if (rate >= 70) return <Badge variant="secondary">Atenção</Badge>;
    return <Badge variant="destructive">Crítico</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Bell className="h-6 w-6" /> Notificações</h1>
          <p className="text-muted-foreground">Gerencie templates, logs e auditoria de entregas</p>
        </div>
        <PageHelp />
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="logs">Logs de Entrega</TabsTrigger>
          {channelHealthMonitoring && (
            <TabsTrigger value="monitoring"><Activity className="h-3.5 w-3.5 mr-1" />Monitoramento</TabsTrigger>
          )}
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
        </TabsList>

        {/* ── Templates Tab ── */}
        <TabsContent value="templates" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <Select value={filterEvent} onValueChange={setFilterEvent}>
              <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Filtrar por evento" /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Todos os eventos</SelectItem>
                {EVENT_TYPES.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Novo Template</Button>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Templates controlam apenas o conteúdo da mensagem.</strong> O roteamento (canal padrão e canais adicionais) é definido em <span className="font-medium text-foreground">Configurações Globais → Notificações</span>. Mantenha versões de conteúdo para cada canal que deseja habilitar.
          </div>

          {isLoading ? <Skeleton className="h-64 w-full" /> : (
            <div className="border rounded-lg scroll-x-safe">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Versão</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum template</TableCell></TableRow>
                  ) : filtered.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm">{EVENT_TYPES.find(e => e.value === t.event_type)?.label || t.event_type}</TableCell>
                      <TableCell><Badge variant="outline" title="Formato de conteúdo (não controla envio)">{t.channel}</Badge></TableCell>
                      <TableCell className="text-sm">{t.title || "—"}</TableCell>
                      <TableCell>v{t.version}</TableCell>
                      <TableCell>{getStatusBadge(t.status || (t.is_active ? "active" : "archived"))}</TableCell>
                      <TableCell className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Edit className="h-4 w-4" /></Button>
                        {t.channel === "whatsapp" && (
                          <Button size="icon" variant="ghost" onClick={() => { setTestDialog(t); setTestPhone(""); }} disabled={testingId === t.id} title="Testar envio WhatsApp">
                            {testingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4 text-green-600" />}
                          </Button>
                        )}
                        {t.channel === "email" && (
                          <Button size="icon" variant="ghost" onClick={() => { setEmailTestDialog(t); setTestEmail(""); }} disabled={testingId === t.id} title="Testar envio E-mail">
                            {testingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4 text-blue-600" />}
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => { if (window.confirm(`Excluir definitivamente o template "${t.title || t.event_type}"? Esta ação não pode ser desfeita.`)) deleteTemplate.mutate(t.id); }} title="Excluir template"><XCircle className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>


        {/* ── Logs Tab ── */}
        <TabsContent value="logs" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Canal</Label>
              <Select value={logChannel} onValueChange={setLogChannel}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent disableSearch>
                  <SelectItem value="all">Todos</SelectItem>
                  {CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={logStatus} onValueChange={setLogStatus}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent disableSearch>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="delivered">Entregue</SelectItem>
                  <SelectItem value="failed">Falha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Evento</Label>
              <Select value={logEvent} onValueChange={setLogEvent}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent disableSearch>
                  <SelectItem value="all">Todos</SelectItem>
                  {EVENT_TYPES.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">De</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-36 justify-start text-left font-normal", !logDateFrom && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {logDateFrom ? format(logDateFrom, "dd/MM/yyyy") : "Início"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={logDateFrom} onSelect={setLogDateFrom} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-36 justify-start text-left font-normal", !logDateTo && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {logDateTo ? format(logDateTo, "dd/MM/yyyy") : "Fim"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={logDateTo} onSelect={setLogDateTo} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {logsLoading ? <Skeleton className="h-64 w-full" /> : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fallback</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!filteredLogs?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum log encontrado</TableCell></TableRow>
                  ) : filteredLogs.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">{EVENT_TYPES.find(e => e.value === l.notifications?.event_type)?.label || l.notifications?.event_type}</TableCell>
                      <TableCell><Badge variant="outline">{l.channel}</Badge></TableCell>
                      <TableCell><Badge variant={l.delivered ? "default" : "destructive"}>{l.delivered ? "Entregue" : "Falha"}</Badge></TableCell>
                      <TableCell>
                        {l.provider_response?.fallback_applied ? (
                          <Badge variant="secondary">Fallback</Badge>
                        ) : l.provider_response?.fallback_triggered ? (
                          <Badge variant="outline">Tentou</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{new Date(l.attempted_at).toLocaleString("pt-BR")}</TableCell>
                      <TableCell>
                        {!l.delivered && allowManualReprocess && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reprocess.mutate(l.notification_id)}
                            disabled={reprocess.isPending}
                          >
                            {reprocess.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                            Reenviar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {/* Batch reprocess */}
          {allowManualReprocess && filteredLogs?.some((l: any) => !l.delivered) && (
            <Button variant="outline" size="sm" onClick={() => {
              const failedIds = [...new Set(filteredLogs!.filter((l: any) => !l.delivered && l.notification_id).map((l: any) => l.notification_id))];
              if (!failedIds.length) return;
              if (!confirm(`Reprocessar ${failedIds.length} notificação(ões) com falha?`)) return;
              failedIds.forEach(id => reprocess.mutate(id));
            }} disabled={reprocess.isPending}>
              <RefreshCw className="h-4 w-4 mr-1" /> Reprocessar Todas as Falhas
            </Button>
          )}
        </TabsContent>

        {/* ── Monitoring Tab ── */}
        <TabsContent value="monitoring">
          <ChannelMonitoringTab />
        </TabsContent>

        {/* ── Audit Tab ── */}
        <TabsContent value="audit">
          <NotificationAuditEnhanced />
        </TabsContent>
      </Tabs>

      {/* Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2 border-b shrink-0">
            <DialogTitle>{editingId ? "Editar Template" : "Novo Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto px-6 py-4 flex-1">
            <div>
              <Label>Evento</Label>
              <Select value={form.event_type} onValueChange={v => setForm(p => ({ ...p, event_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Formato de conteúdo</Label>
                <Select value={form.channel} onValueChange={v => setForm(p => ({ ...p, channel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">Define o formato (texto curto para Push, HTML para E-mail, texto WhatsApp). O envio é controlado nas Configurações Globais.</p>
              </div>
              <div>
                <Label>Prioridade</Label>
                <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.channel !== "whatsapp" && (
              <>
                <div>
                  <Label>Título</Label>
                  <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da notificação" />
                </div>
                <div>
                  <Label>Corpo da mensagem</Label>
                  <Textarea value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} placeholder="Use variáveis: {{nome}}, {{data}}, {{hora}}, {{cargo}}, {{unidade}}" className="min-h-[80px]" />
                  <p className="text-xs text-muted-foreground mt-1">Variáveis: {"{{nome}}, {{data}}, {{hora}}, {{cargo}}, {{unidade}}, {{documento}}, {{motivo}}"}</p>
                  {aiTemplateReviewEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={handleAiSuggest}
                    disabled={aiSuggesting || !form.event_type}
                  >
                    {aiSuggesting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Sugerir com IA
                  </Button>
                  )}
                </div>
                {aiSuggestion && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <p className="text-xs font-medium text-primary flex items-center gap-1"><Sparkles className="h-3 w-3" /> Sugestão da IA</p>
                    <p className="text-xs text-muted-foreground">Título: <span className="font-medium text-foreground">{aiSuggestion.title}</span></p>
                    <p className="text-xs text-muted-foreground">Corpo: <span className="text-foreground">{aiSuggestion.body}</span></p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="default" onClick={() => {
                        setForm(p => ({ ...p, title: aiSuggestion.title, body: aiSuggestion.body }));
                        setAiSuggestion(null);
                        toast.success("Sugestão aplicada!");
                      }}>Aplicar</Button>
                      <Button size="sm" variant="outline" onClick={() => setAiSuggestion(null)}>Descartar</Button>
                    </div>
                  </div>
                )}
                {form.body && (
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                    <p className="text-sm">{preview}</p>
                  </div>
                )}
              </>
            )}
            {form.channel === "whatsapp" && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground">
                No WhatsApp via Meta, o conteúdo é definido pelo template HSM aprovado abaixo. Título, corpo e "Sugerir com IA" não se aplicam.
              </div>
            )}
            {form.channel === "whatsapp" && (
              <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-3 w-3 text-amber-600" />
                  Template HSM da Meta (necessário fora da janela de 24h)
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nome do template aprovado na Meta</Label>
                  <Input
                    value={form.meta_template_name}
                    onChange={e => setForm(p => ({ ...p, meta_template_name: e.target.value }))}
                    placeholder="ex: lembrete_entrevista_24h"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Idioma do HSM</Label>
                  <Select value={form.meta_template_language} onValueChange={v => setForm(p => ({ ...p, meta_template_language: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt_BR">Português (pt_BR)</SelectItem>
                      <SelectItem value="en_US">Inglês (en_US)</SelectItem>
                      <SelectItem value="es_ES">Espanhol (es_ES)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Mapeamento de variáveis (uma por linha, na ordem dos {"{{1}}, {{2}}..."} do HSM)</Label>
                  <Textarea
                    value={form.meta_variable_mapping}
                    onChange={e => setForm(p => ({ ...p, meta_variable_mapping: e.target.value }))}
                    placeholder={"{{nome}}\n{{cargo}}\n{{data}}\n{{hora}}\n{{link}}"}
                    className="min-h-[100px] font-mono text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Cada linha vira um parâmetro do BODY do HSM, na ordem. Use {"{{var}}"} para puxar do payload da notificação.
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>Status do template</Label>
              <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v, is_active: v === "active" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMPLATE_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Ciclo: Rascunho → Aprovado → Ativo → Arquivado</p>
            </div>


            <Button className="w-full" onClick={handleSave} disabled={createTemplate.isPending || updateTemplate.isPending}>
              {(createTemplate.isPending || updateTemplate.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editingId ? "Salvar" : "Criar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Test WhatsApp Dialog */}
      <Dialog open={!!testDialog} onOpenChange={(o) => { if (!o) { setTestDialog(null); setTestPhone(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-600" /> Testar Envio WhatsApp
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground mb-1">Template: <span className="font-medium text-foreground">{EVENT_TYPES.find(e => e.value === testDialog?.event_type)?.label || testDialog?.event_type}</span></p>
              <p className="text-xs text-muted-foreground mb-1">Preview da mensagem:</p>
              <p className="text-sm whitespace-pre-wrap">
                {testDialog && `*${(testDialog.title || testDialog.event_type).replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => SAMPLE_VARS[key] ?? `{{${key}}}`)}*\n\n${testDialog.body.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => SAMPLE_VARS[key] ?? `{{${key}}}`)}`}
              </p>
            </div>
            <div>
              <Label>Número de telefone para teste</Label>
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Ex: 11999998888"
                type="tel"
              />
              <p className="text-xs text-muted-foreground mt-1">Digite o número com DDD (sem +55)</p>
            </div>
            <Button
              className="w-full"
              onClick={handleTestWhatsApp}
              disabled={!testPhone || testingId === testDialog?.id}
            >
              {testingId === testDialog?.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar Teste
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Email Dialog */}
      <Dialog open={!!emailTestDialog} onOpenChange={(o) => { if (!o) { setEmailTestDialog(null); setTestEmail(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-600" /> Testar Envio E-mail
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground mb-1">Template: <span className="font-medium text-foreground">{EVENT_TYPES.find(e => e.value === emailTestDialog?.event_type)?.label || emailTestDialog?.event_type}</span></p>
              <p className="text-xs text-muted-foreground mb-1">Preview do conteúdo:</p>
              <p className="text-sm whitespace-pre-wrap">
                {emailTestDialog && emailTestDialog.body.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => SAMPLE_VARS[key] ?? `{{${key}}}`)}
              </p>
            </div>
            <div>
              <Label>Endereço de e-mail para teste</Label>
              <Input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="teste@exemplo.com"
                type="email"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleTestEmail}
              disabled={!testEmail || testingId === emailTestDialog?.id}
            >
              {testingId === emailTestDialog?.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar Teste
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
