import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { ymdToLocalDate, dateToLocalYMD } from "@/lib/dateUtils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Shield,
  Brain,
  History,
  AlertTriangle,
  Download,
  Search,
  Activity,
  Clock,
  FileJson,
  FileText,
  ChevronDown,
  Sparkles,
  FileArchive,
  ShieldCheck,
  Loader2,
  MessageSquareWarning,
} from "lucide-react";
import { ChatErrorsAuditTab } from "@/components/admin/audit/ChatErrorsAuditTab";
import {
  useActivityLogs,
  useCPFHistory,
  useAuditMetrics,
  useAuditTrail,
  exportToCSV,
  exportToJSON,
  exportToPDF,
} from "@/hooks/useAuditLogs";
import { useAIDecisionLogs } from "@/hooks/useAIAudit";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHelp } from "@/components/ui/page-help";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { logSensitiveAccess } from "@/lib/accessLogHelper";

function MetricCard({ title, value, icon: Icon, variant = "default" }: {
  title: string;
  value: number;
  icon: any;
  variant?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`p-3 rounded-lg ${
          variant === "warning" ? "bg-yellow-500/10 text-yellow-600" :
          variant === "danger" ? "bg-destructive/10 text-destructive" :
          variant === "info" ? "bg-blue-500/10 text-blue-600" :
          "bg-primary/10 text-primary"
        }`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(d: string) {
  try { return format(new Date(d), "dd/MM/yyyy HH:mm"); } catch { return d; }
}

function EventBadge({ action }: { action: string }) {
  const lower = action.toLowerCase();
  if (lower.includes("security") || lower.includes("alert") || lower.includes("fail"))
    return <Badge variant="destructive" className="text-xs">{action}</Badge>;
  if (lower.includes("aprovad") || lower.includes("contrata"))
    return <Badge className="bg-green-600 text-xs">{action}</Badge>;
  if (lower.includes("rejeit") || lower.includes("reprovad") || lower.includes("standby"))
    return <Badge className="bg-yellow-600 text-xs">{action}</Badge>;
  return <Badge variant="secondary" className="text-xs">{action}</Badge>;
}

// Hook for critical alerts based on CrossConfig
function useCriticalAlerts(criticalActions: string[], enabled: boolean) {
  return useQuery({
    queryKey: ["critical_alerts", criticalActions],
    enabled: enabled && criticalActions.length > 0,
    queryFn: async () => {
      const orFilter = criticalActions.map(a => `action.eq.${a}`).join(",");
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .or(orFilter)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

// Gap 4: AI explain decision
async function explainDecision(log: any) {
  toast.info("Gerando explicação da decisão...");
  try {
    const { data, error } = await supabase.functions.invoke("faq-assistant", {
      body: {
        question: `Explique a decisão da IA para o candidato CPF ${log.cpf} no módulo ${log.module}. Tipo: ${log.decision_type}. Input: ${JSON.stringify(log.input).slice(0, 500)}. Output: ${JSON.stringify(log.output).slice(0, 500)}.`,
      },
    });
    if (error) throw error;
    toast.success(data?.answer || "Explicação gerada.", { duration: 10000 });
  } catch {
    toast.error("Não foi possível gerar a explicação.");
  }
}

function VerifyHashesButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleVerify = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("verify-audit-hashes", {
        body: { sample_size: 100 },
      });
      if (error) throw error;
      setResult(data);
      if (data?.verified) {
        toast.success("Integridade verificada — nenhum hash ausente detectado.");
      } else {
        toast.warning("Verificação concluída — foram encontrados registros sem hash válido.");
      }
    } catch (err: any) {
      toast.error("Erro ao verificar hashes: " + (err.message || "erro desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleVerify} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
        Verificar Integridade
      </Button>
      {result && !result.skipped && (
        <Badge variant={result.verified ? "default" : "destructive"} className="text-xs">
          {result.verified ? "✓ Íntegro" : "⚠ Hashes ausentes"}
        </Badge>
      )}
    </div>
  );
}

export default function AuditLogs() {
  useEffect(() => { logSensitiveAccess("logs_auditoria"); }, []);
  const [tab, setTab] = useState("timeline");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cpfSearch, setCpfSearch] = useState("");
  const [cpfQuery, setCpfQuery] = useState("");

  // Gap 2: AI decision filters
  const [aiDecisionType, setAiDecisionType] = useState("all");
  const [aiModule, setAiModule] = useState("all");

  // Gap 7: Export tab state
  const [exportSource, setExportSource] = useState("timeline");
  const [exportFormat, setExportFormat] = useState("csv");
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");

  const filters = {
    module: moduleFilter !== "all" ? moduleFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  // CrossConfig compliance settings
  const { data: securitySettings } = useGlobalSettings("security");
  const { data: complianceSettings } = useGlobalSettings("compliance");

  const criticalActions = useMemo(() => {
    const setting = complianceSettings?.find(s => s.key === "critical_actions");
    if (setting?.value && Array.isArray(setting.value)) return setting.value as string[];
    return ["pipeline_deleted", "job_deleted", "config_alterada", "ai_criteria_changed", "channel_disabled"];
  }, [complianceSettings]);

  // Gap 1: Check critical_change_alert flag before loading alerts
  const criticalChangeAlertEnabled = useMemo(() => {
    const s = complianceSettings?.find(s => s.key === "critical_change_alert");
    return s?.value !== false && s?.value !== "false";
  }, [complianceSettings]);

  const auditExportEnabled = useMemo(() => {
    const s = securitySettings?.find(s => s.key === "audit_export_enabled");
    return s?.value !== false && s?.value !== "false";
  }, [securitySettings]);

  const pdfExportEnabled = useMemo(() => {
    const s = complianceSettings?.find(s => s.key === "allow_export_pdf");
    return s?.value !== false && s?.value !== "false";
  }, [complianceSettings]);

  const cpfHistoryEnabled = useMemo(() => {
    const s = securitySettings?.find(s => s.key === "cpf_history_enabled");
    return s?.value !== false && s?.value !== "false";
  }, [securitySettings]);

  const { data: metrics } = useAuditMetrics();
  const { data: activityLogs = [], isLoading: loadingActivity } = useActivityLogs(filters);
  const { data: auditTrail = [] } = useAuditTrail(filters);
  
  // Gap 2: Pass decision_type filter
  const { data: aiLogs = [], isLoading: loadingAI } = useAIDecisionLogs({
    decision_type: aiDecisionType !== "all" ? aiDecisionType : undefined,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    cpf: cpfQuery || undefined,
  });
  
  const { data: cpfHistory = [], isLoading: loadingCPF } = useCPFHistory(cpfQuery || undefined);
  
  // Gap 1: Only load alerts if critical_change_alert is enabled
  const { data: alerts = [], isLoading: loadingAlerts } = useCriticalAlerts(criticalActions, criticalChangeAlertEnabled);

  // Gap 2: Filter AI logs by module client-side
  const filteredAiLogs = useMemo(() => {
    if (aiModule === "all") return aiLogs;
    return aiLogs.filter((l) => l.module === aiModule);
  }, [aiLogs, aiModule]);

  // Get unique decision types and modules from AI logs for filter options
  const aiDecisionTypes = useMemo(() => {
    const types = new Set(aiLogs.map((l) => l.decision_type));
    return Array.from(types).filter(Boolean).sort();
  }, [aiLogs]);

  const aiModules = useMemo(() => {
    const mods = new Set(aiLogs.map((l) => l.module));
    return Array.from(mods).filter(Boolean).sort();
  }, [aiLogs]);

  // Merge for timeline
  const timeline = useMemo(() => {
    const items = [
      ...activityLogs.map((l: any) => ({ ...l, source: "activity" })),
      ...auditTrail.map((l: any) => ({ ...l, source: "audit", module: l.target_type })),
    ];
    if (cpfQuery && cpfHistory.length > 0) {
      items.push(
        ...cpfHistory.map((h: any) => ({
          id: h.id,
          action: h.event,
          module: h.source_module,
          created_at: h.created_at,
          details: h.metadata,
          source: "cpf_history",
        }))
      );
    }
    return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [activityLogs, auditTrail, cpfQuery, cpfHistory]);

  const handleExport = (data: any[], name: string) => {
    exportToCSV(data, name);
  };

  const handleExportJSON = (data: any[], name: string) => {
    exportToJSON(data, name);
  };

  const handleExportPDF = (data: any[], name: string, title: string) => {
    exportToPDF(data, name, title);
  };

  function ExportDropdown({ data, name, title }: { data: any[]; name: string; title: string }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={!data.length}>
            <Download className="h-4 w-4 mr-1" /> Exportar <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => handleExport(data, name)}>
            <FileText className="h-4 w-4 mr-2" /> CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExportJSON(data, name)}>
            <FileJson className="h-4 w-4 mr-2" /> JSON
          </DropdownMenuItem>
          {pdfExportEnabled && (
            <DropdownMenuItem onClick={() => handleExportPDF(data, name, title)}>
              <FileText className="h-4 w-4 mr-2" /> PDF
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const handleCpfSearch = () => {
    const cleaned = cpfSearch.replace(/\D/g, "");
    if (cleaned.length >= 11) setCpfQuery(cleaned);
  };

  // Centralized export handler — uses server-side export_audit_with_hash for integrity
  const handleCentralizedExport = async () => {
    const sourceMap: Record<string, string> = {
      timeline: "activity_logs",
      ai: "ai_decision_logs",
      cpf: "cpf_history",
      alerts: "activity_logs",
    };
    const sourceTitle: Record<string, string> = {
      timeline: "Linha do Tempo — Auditoria",
      ai: "Decisões da IA — Auditoria",
      cpf: `Histórico CPF ${cpfQuery} — Auditoria`,
      alerts: "Alertas Críticos — Auditoria",
    };

    const dbSource = sourceMap[exportSource] || "activity_logs";

    try {
      // Use server-side export with hash
      const { data, error } = await supabase.rpc("export_audit_with_hash", {
        p_source: dbSource,
        p_date_from: exportDateFrom ? new Date(exportDateFrom + "T00:00:00").toISOString() : null,
        p_date_to: exportDateTo ? new Date(exportDateTo + "T23:59:59").toISOString() : null,
        p_limit: 500,
      });

      if (error) throw error;

      const exportData = data as any;
      if (!exportData?.data || exportData.data.length === 0) {
        toast.warning("Nenhum dado para exportar com os filtros selecionados.");
        return;
      }

      const title = sourceTitle[exportSource] || "Auditoria";

      if (exportFormat === "json") {
        // Already has hash envelope from server
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${exportSource}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (exportFormat === "csv") {
        // Convert to CSV with hash header from server
        const rows = exportData.data;
        if (rows.length === 0) return;
        const headers = Object.keys(rows[0]);
        const csvRows = [
          headers.join(","),
          ...rows.map((row: any) =>
            headers.map((h) => {
              const val = row[h];
              const str = typeof val === "object" ? JSON.stringify(val) : String(val ?? "");
              return `"${str.replace(/"/g, '""')}"`;
            }).join(",")
          ),
        ];
        const csvContent = `# SHA-256: ${exportData._meta.sha256}\n# Exportado em: ${exportData._meta.exported_at}\n# Fonte: ${exportData._meta.source}\n# Total: ${exportData._meta.total_records}\n${csvRows.join("\n")}`;
        const blob = new Blob([csvContent], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${exportSource}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (exportFormat === "pdf") {
        handleExportPDF(exportData.data, exportSource, title);
      }

      toast.success(`Exportação ${exportFormat.toUpperCase()} concluída com hash SHA-256 do servidor (${exportData._meta.sha256.slice(0, 12)}…)`);
    } catch (err: any) {
      console.error("Server export error:", err);
      // Fallback to client-side export
      toast.warning("Exportação server-side indisponível. Usando exportação client-side.");
      let sourceData: any[] = [];
      switch (exportSource) {
        case "timeline": sourceData = timeline; break;
        case "ai": sourceData = filteredAiLogs; break;
        case "cpf": sourceData = cpfHistory; break;
        case "alerts": sourceData = alerts; break;
      }
      if (exportDateFrom || exportDateTo) {
        sourceData = sourceData.filter((item: any) => {
          const date = item.created_at;
          if (exportDateFrom && date < exportDateFrom) return false;
          if (exportDateTo && date > exportDateTo + "T23:59:59") return false;
          return true;
        });
      }
      if (!sourceData.length) {
        toast.warning("Nenhum dado para exportar.");
        return;
      }
      switch (exportFormat) {
        case "csv": handleExport(sourceData, exportSource); break;
        case "json": handleExportJSON(sourceData, exportSource); break;
        case "pdf": handleExportPDF(sourceData, exportSource, sourceTitle[exportSource] || "Auditoria"); break;
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6" />
          Auditoria e Logs
        </h2>
        <div className="flex items-center gap-2">
          <VerifyHashesButton />
          <PageHelp />
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="Total de Eventos" value={metrics?.totalEvents || 0} icon={Activity} />
        <MetricCard title="Decisões IA" value={metrics?.aiDecisions || 0} icon={Brain} variant="info" />
        <MetricCard title="Alertas Críticos" value={criticalChangeAlertEnabled ? alerts.length : 0} icon={AlertTriangle} variant="danger" />
        <MetricCard title="Ações Hoje" value={metrics?.todayActions || 0} icon={Clock} variant="warning" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Módulo</label>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="auth">Auth</SelectItem>
                <SelectItem value="recrutamento">Recrutamento</SelectItem>
                <SelectItem value="documentos">Documentos</SelectItem>
                <SelectItem value="migracao">Migração</SelectItem>
                <SelectItem value="configuracao">Configuração</SelectItem>
                <SelectItem value="entrevistas">Entrevistas</SelectItem>
                <SelectItem value="notificacoes">Notificações</SelectItem>
                <SelectItem value="banco_de_talentos">Banco de Talentos</SelectItem>
                <SelectItem value="ia">IA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">De</label>
            <MaskedDateInput value={ymdToLocalDate(dateFrom)} onChange={(d) => setDateFrom(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="De" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Até</label>
            <MaskedDateInput value={ymdToLocalDate(dateTo)} onChange={(d) => setDateTo(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="Até" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Buscar CPF</label>
            <div className="flex gap-2">
              <Input
                placeholder="000.000.000-00"
                value={cpfSearch}
                onChange={(e) => setCpfSearch(e.target.value)}
                className="w-full"
                onKeyDown={(e) => e.key === "Enter" && handleCpfSearch()}
              />
              <Button size="icon" variant="outline" onClick={handleCpfSearch}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {cpfQuery && (
            <Button variant="ghost" size="sm" onClick={() => { setCpfQuery(""); setCpfSearch(""); }}>
              Limpar CPF
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Tabs — Gap 7: 5th tab "Exportações" */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="timeline" className="flex items-center gap-1">
            <History className="h-4 w-4 shrink-0" /> Linha do Tempo
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex items-center gap-1">
            <Brain className="h-4 w-4 shrink-0" /> Decisões IA
          </TabsTrigger>
          {cpfHistoryEnabled && (
            <TabsTrigger value="cpf" className="flex items-center gap-1">
              <Search className="h-4 w-4 shrink-0" /> Histórico CPF
            </TabsTrigger>
          )}
          {criticalChangeAlertEnabled && (
            <TabsTrigger value="alerts" className="flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Alertas
            </TabsTrigger>
          )}
          <TabsTrigger value="chat" className="flex items-center gap-1">
            <MessageSquareWarning className="h-4 w-4 shrink-0" /> Chat
          </TabsTrigger>
          {auditExportEnabled && (
            <TabsTrigger value="exports" className="flex items-center gap-1">
              <FileArchive className="h-4 w-4 shrink-0" /> Exportações
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="chat">
          <ChatErrorsAuditTab />
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">
                Linha do Tempo Geral
                <Badge variant="outline" className="ml-2 text-xs">{timeline.length} registros</Badge>
              </CardTitle>
              {auditExportEnabled && (
                <ExportDropdown data={timeline} name="timeline" title="Linha do Tempo — Auditoria" />
              )}
            </CardHeader>
            <CardContent>
              {loadingActivity ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : timeline.length === 0 ? (
                <p className="text-muted-foreground">Nenhum evento encontrado.</p>
              ) : (
                <div className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Ação</TableHead>
                        <TableHead>Módulo</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead>Detalhes</TableHead>
                        <TableHead>Hash</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timeline.slice(0, 200).map((log: any) => (
                        <TableRow key={`${log.source}-${log.id}`}>
                          <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                          <TableCell><EventBadge action={log.action} /></TableCell>
                          <TableCell className="text-xs">{log.module || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{log.source}</Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">
                            {log.details ? JSON.stringify(log.details).slice(0, 80) : log.context ? JSON.stringify(log.context).slice(0, 80) : "—"}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {log.record_hash ? log.record_hash.slice(0, 8) + "…" : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Decisions Tab — Gap 2: filters */}
        <TabsContent value="ai">
          <div className="space-y-4">
            {/* Gap 2: AI-specific filters */}
            <Card>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 items-end">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Tipo de Decisão</label>
                  <Select value={aiDecisionType} onValueChange={setAiDecisionType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {aiDecisionTypes.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Módulo de Origem</label>
                  <Select value={aiModule} onValueChange={setAiModule}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {aiModules.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">
                  Decisões da IA
                  <Badge variant="outline" className="ml-2 text-xs">{filteredAiLogs.length} registros</Badge>
                </CardTitle>
                {auditExportEnabled && (
                  <ExportDropdown data={filteredAiLogs} name="ai_decisions" title="Decisões da IA — Auditoria" />
                )}
              </CardHeader>
              <CardContent>
                {loadingAI ? (
                  <p className="text-muted-foreground">Carregando...</p>
                ) : filteredAiLogs.length === 0 ? (
                  <p className="text-muted-foreground">Nenhuma decisão IA registrada.</p>
                ) : (
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>CPF</TableHead>
                          <TableHead>Módulo</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Modelo</TableHead>
                          <TableHead>Tempo (ms)</TableHead>
                          <TableHead>Hash</TableHead>
                          <TableHead>Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAiLogs.map((log: any) => (
                          <TableRow key={log.id}>
                            <TableCell className="whitespace-nowrap text-xs">{formatDate(log.created_at)}</TableCell>
                            <TableCell className="text-xs font-mono">{log.cpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.***.$3-$4")}</TableCell>
                            <TableCell className="text-xs">{log.module}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{log.decision_type}</Badge></TableCell>
                            <TableCell className="text-xs">{log.model_version || log.model_provider || "—"}</TableCell>
                            <TableCell className="text-xs">{log.processing_time_ms || "—"}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{log.record_hash ? log.record_hash.slice(0, 8) + "…" : "—"}</TableCell>
                            <TableCell>
                              {/* Gap 4: Explain Decision button */}
                              <Button variant="ghost" size="sm" onClick={() => explainDecision(log)} title="Explicar decisão via IA">
                                <Sparkles className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Version Comparison Chart */}
            {filteredAiLogs.length > 0 && (() => {
              const versionMap: Record<string, { count: number; totalMs: number }> = {};
              for (const log of filteredAiLogs) {
                const ver = log.model_version || log.model_provider || "desconhecido";
                if (!versionMap[ver]) versionMap[ver] = { count: 0, totalMs: 0 };
                versionMap[ver].count++;
                versionMap[ver].totalMs += log.processing_time_ms || 0;
              }
              const chartData = Object.entries(versionMap).map(([version, m]) => ({
                version,
                decisoes: m.count,
                tempoMedio: m.count > 0 ? Math.round(m.totalMs / m.count) : 0,
              }));
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Comparativo entre Versões da IA</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="version" fontSize={11} />
                        <YAxis yAxisId="left" fontSize={11} />
                        <YAxis yAxisId="right" orientation="right" fontSize={11} />
                        <Tooltip />
                        <Bar yAxisId="left" dataKey="decisoes" fill="hsl(var(--primary))" name="Decisões" radius={[4,4,0,0]} />
                        <Bar yAxisId="right" dataKey="tempoMedio" fill="hsl(var(--muted-foreground))" name="Tempo Médio (ms)" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              );
            })()}
          </div>
        </TabsContent>

        {/* CPF History Tab */}
        <TabsContent value="cpf">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">
                Histórico por CPF
                {cpfHistory.length > 0 && (
                  <Badge variant="outline" className="ml-2 text-xs">{cpfHistory.length} registros</Badge>
                )}
              </CardTitle>
              {cpfHistory.length > 0 && auditExportEnabled && (
                <ExportDropdown data={cpfHistory} name={`cpf_${cpfQuery}`} title={`Histórico CPF ${cpfQuery} — Auditoria`} />
              )}
            </CardHeader>
            <CardContent>
              {!cpfQuery ? (
                <p className="text-muted-foreground">Digite um CPF no campo acima e clique em buscar para ver o histórico completo.</p>
              ) : loadingCPF ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : cpfHistory.length === 0 ? (
                <p className="text-muted-foreground">Nenhum histórico encontrado para o CPF {cpfQuery}.</p>
              ) : (
                <div className="max-h-[500px] overflow-auto">
                  <div className="space-y-3">
                    {cpfHistory.map((entry: any) => (
                      <div key={entry.id} className="flex items-start gap-3 border-l-2 border-primary/30 pl-4 py-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <EventBadge action={entry.event} />
                            <span className="text-xs text-muted-foreground">{entry.source_module}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{formatDate(entry.created_at)}</p>
                          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {JSON.stringify(entry.metadata).slice(0, 120)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alerts Tab — Gap 1: only shows if critical_change_alert is enabled */}
        <TabsContent value="alerts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">
                Alertas Críticos
                <Badge variant="outline" className="ml-2 text-xs">{alerts.length} registros</Badge>
              </CardTitle>
              <div className="flex gap-2">
                {/* Gap 4: Diagnose patterns button */}
                <Button variant="outline" size="sm" onClick={async () => {
                  toast.info("Diagnosticando padrões...");
                  try {
                    const summary = alerts.slice(0, 20).map((a: any) => `${a.action} (${a.module || "?"}) em ${a.created_at}`).join("; ");
                    const { data, error } = await supabase.functions.invoke("faq-assistant", {
                      body: { question: `Identifique padrões de alterações críticas neste log de auditoria: ${summary}` },
                    });
                    if (error) throw error;
                    toast.success(data?.answer || "Análise concluída.", { duration: 15000 });
                  } catch {
                    toast.error("Não foi possível diagnosticar padrões.");
                  }
                }}>
                  <Sparkles className="h-4 w-4 mr-1" /> Diagnosticar Padrões
                </Button>
                {auditExportEnabled && (
                  <ExportDropdown data={alerts} name="critical_alerts" title="Alertas Críticos — Auditoria" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Ações monitoradas: {criticalActions.join(", ")}
              </p>
              {loadingAlerts ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : alerts.length === 0 ? (
                <p className="text-muted-foreground flex items-center gap-2">
                  <Shield className="h-5 w-5 text-green-600" /> Nenhum alerta crítico registrado. Tudo limpo!
                </p>
              ) : (
                <div className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Ação</TableHead>
                        <TableHead>Módulo</TableHead>
                        <TableHead>Detalhes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {alerts.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell className="whitespace-nowrap text-xs">{formatDate(a.created_at)}</TableCell>
                          <TableCell><Badge variant="destructive" className="text-xs">{a.action}</Badge></TableCell>
                          <TableCell className="text-xs">{a.module || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">
                            {a.details ? JSON.stringify(a.details).slice(0, 80) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Gap 7: Exports Tab */}
        <TabsContent value="exports">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileArchive className="h-5 w-5" />
                Central de Exportações
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Selecione a fonte de dados, período e formato para gerar uma exportação auditável com hash de integridade SHA-256.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Fonte de Dados</Label>
                  <Select value={exportSource} onValueChange={setExportSource}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="timeline">Linha do Tempo</SelectItem>
                      <SelectItem value="ai">Decisões IA</SelectItem>
                      <SelectItem value="cpf">Histórico CPF</SelectItem>
                      <SelectItem value="alerts">Alertas Críticos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">De</Label>
                  <MaskedDateInput
                    value={ymdToLocalDate(exportDateFrom)}
                    onChange={(d) => setExportDateFrom(dateToLocalYMD(d))}
                    format="dd/MM/yyyy"
                    placeholder="Data início"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Até</Label>
                  <MaskedDateInput
                    value={ymdToLocalDate(exportDateTo)}
                    onChange={(d) => setExportDateTo(dateToLocalYMD(d))}
                    format="dd/MM/yyyy"
                    placeholder="Data fim"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Formato</Label>
                  <Select value={exportFormat} onValueChange={setExportFormat}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                      {pdfExportEnabled && <SelectItem value="pdf">PDF</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleCentralizedExport} className="w-full sm:w-auto">
                <Download className="h-4 w-4 mr-2" /> Exportar com Hash de Integridade
              </Button>
              <p className="text-xs text-muted-foreground">
                Todos os arquivos CSV e JSON exportados incluem checksum SHA-256 para verificação de integridade jurídica.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
