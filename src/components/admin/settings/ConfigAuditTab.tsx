import { useState } from "react";
import { useConfigAuditLogs, useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import {
  useConfigVersions,
  useCreateConfigVersion,
  useRollbackToVersion,
  useRollbackEvents,
} from "@/hooks/useConfigVersions";
import { useFeatureActivationLogs } from "@/hooks/useFeatureFlags";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Loader2, Clock, GitBranch, RotateCcw, Shield, Plus, Eye, AlertTriangle, Download, FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { exportToPDF } from "@/hooks/useAuditLogs";

// ── Unified Timeline Data Hook ──
interface UnifiedTimelineEntry {
  id: string;
  date: string;
  entity_type: string;
  category: string;
  key: string;
  old_value: any;
  new_value: any;
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
}

function useUnifiedTimeline() {
  const { data: auditLogs, isLoading: l1 } = useConfigAuditLogs();
  const { data: activationLogs, isLoading: l2 } = useFeatureActivationLogs();
  const { data: rollbackEvents, isLoading: l3 } = useRollbackEvents();

  // Fetch profile names for all unique user IDs
  const allUserIds = new Set<string>();
  auditLogs?.forEach((l) => l.changed_by && allUserIds.add(l.changed_by));
  activationLogs?.forEach((l) => l.changed_by && allUserIds.add(l.changed_by));
  rollbackEvents?.forEach((e) => e.triggered_by && allUserIds.add(e.triggered_by));

  const userIdsArray = Array.from(allUserIds);

  const { data: profiles } = useQuery({
    queryKey: ["profiles_for_audit", userIdsArray.join(",")],
    enabled: userIdsArray.length > 0,
    queryFn: async () => {
      if (userIdsArray.length === 0) return {};
      const { data } = await supabase
        .from("candidate_profiles" as any)
        .select("candidate_id, full_name")
        .in("candidate_id", userIdsArray);
      const map: Record<string, string> = {};
      (data as any[])?.forEach((p: any) => { map[p.candidate_id] = p.full_name; });
      return map;
    },
  });

  const profileMap = profiles || {};

  const entries: UnifiedTimelineEntry[] = [];

  // Config audit logs
  auditLogs?.forEach((log) => {
    entries.push({
      id: log.id,
      date: log.changed_at,
      entity_type: (log as any).entity_type || "cross_config",
      category: log.category || "",
      key: log.key || "",
      old_value: log.old_value,
      new_value: log.new_value,
      reason: log.reason,
      changed_by: log.changed_by,
      changed_by_name: log.changed_by ? profileMap[log.changed_by] || null : null,
    });
  });

  // Feature activation logs (only those NOT already in config_audit_logs via entity_type)
  const auditFlagKeys = new Set(
    auditLogs?.filter((l) => (l as any).entity_type === "feature_flag").map((l) => l.changed_at) || []
  );
  activationLogs?.forEach((log) => {
    if (auditFlagKeys.has(log.changed_at)) return;
    entries.push({
      id: log.id,
      date: log.changed_at,
      entity_type: "feature_flag",
      category: "feature_flags",
      key: log.module_name,
      old_value: log.previous_status,
      new_value: log.new_status,
      reason: null,
      changed_by: log.changed_by,
      changed_by_name: log.changed_by ? profileMap[log.changed_by] || null : null,
    });
  });

  // Rollback events
  rollbackEvents?.forEach((e) => {
    entries.push({
      id: e.id,
      date: e.created_at,
      entity_type: "rollback",
      category: "auditoria",
      key: `rollback → ${e.restored_version_id.slice(0, 8)}`,
      old_value: null,
      new_value: null,
      reason: e.justification,
      changed_by: e.triggered_by,
      changed_by_name: e.triggered_by ? profileMap[e.triggered_by] || null : null,
    });
  });

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { data: entries, isLoading: l1 || l2 || l3 };
}

// ── Timeline Sub-tab ──
function TimelineTab() {
  const { data: entries, isLoading } = useUnifiedTimeline();
  const { data: auditSettings } = useGlobalSettings("audit");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const exportEnabled = auditSettings?.find((s) => s.key === "audit_export_enabled")?.value !== false;

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const filtered = (entries || []).filter((e) => {
    if (categoryFilter && categoryFilter !== "all" && e.category !== categoryFilter) return false;
    if (entityTypeFilter && entityTypeFilter !== "all" && e.entity_type !== entityTypeFilter) return false;
    if (searchFilter && !e.key?.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    return true;
  });

  const categories = [...new Set((entries || []).map((e) => e.category).filter(Boolean))];
  const entityTypes = [...new Set((entries || []).map((e) => e.entity_type).filter(Boolean))];

  const entityTypeLabel = (t: string) => {
    switch (t) {
      case "cross_config": return "CrossConfig";
      case "feature_flag": return "Feature Flag";
      case "automation": return "Automação";
      case "rollback": return "Rollback";
      default: return t;
    }
  };

  const entityTypeBadgeVariant = (t: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (t) {
      case "cross_config": return "outline";
      case "feature_flag": return "default";
      case "automation": return "secondary";
      case "rollback": return "destructive";
      default: return "outline";
    }
  };

  const handleExportCSV = () => {
    if (!filtered.length) return;
    const headers = ["Data", "Tipo", "Categoria", "Configuração", "Valor anterior", "Novo valor", "Responsável", "Justificativa"];
    const rows = filtered.map((e) => [
      format(new Date(e.date), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      entityTypeLabel(e.entity_type),
      e.category || "",
      e.key || "",
      JSON.stringify(e.old_value),
      JSON.stringify(e.new_value),
      e.changed_by_name || e.changed_by || "",
      e.reason || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_config_${format(new Date(), "yyyyMMdd_HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    if (!filtered.length) return;
    const pdfData = filtered.map((e) => ({
      Data: format(new Date(e.date), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      Tipo: entityTypeLabel(e.entity_type),
      Categoria: e.category || "",
      Chave: e.key || "",
      "Valor anterior": JSON.stringify(e.old_value)?.slice(0, 80) || "",
      "Novo valor": JSON.stringify(e.new_value)?.slice(0, 80) || "",
      Responsável: e.changed_by_name || e.changed_by?.slice(0, 8) || "",
      Justificativa: e.reason || "",
    }));
    exportToPDF(pdfData, "audit_config", "Relatório de Auditoria — CrossConfig");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <Input
          placeholder="Buscar por chave..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="w-full sm:max-w-xs"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todas</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Tipo de entidade" />
          </SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos</SelectItem>
            {entityTypes.map((t) => (
              <SelectItem key={t} value={t}>{entityTypeLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!filtered.length || !exportEnabled}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!filtered.length || !exportEnabled}>
          <FileText className="h-4 w-4 mr-1" /> PDF
        </Button>
        {!exportEnabled && <span className="text-xs text-muted-foreground">Exportação desativada</span>}
      </div>

      {filtered.length > 0 ? (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Configuração</TableHead>
              <TableHead>Valor anterior</TableHead>
              <TableHead>Novo valor</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Justificativa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={`${e.entity_type}-${e.id}`}>
                <TableCell className="text-xs whitespace-nowrap">
                  {format(new Date(e.date), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </TableCell>
                <TableCell>
                  <Badge variant={entityTypeBadgeVariant(e.entity_type)}>{entityTypeLabel(e.entity_type)}</Badge>
                </TableCell>
                <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{e.key}</TableCell>
                <TableCell className="text-xs max-w-[120px] truncate">{JSON.stringify(e.old_value)}</TableCell>
                <TableCell className="text-xs max-w-[120px] truncate">{JSON.stringify(e.new_value)}</TableCell>
                <TableCell className="text-xs max-w-[120px] truncate">
                  {e.changed_by_name || (e.changed_by ? e.changed_by.slice(0, 8) + "…" : "—")}
                </TableCell>
                <TableCell className="text-xs max-w-[120px] truncate text-muted-foreground">
                  {e.reason || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-4">Nenhuma alteração encontrada.</p>
      )}
    </div>
  );
}

// ── Versions Sub-tab ──
function VersionsTab() {
  const { data: versions, isLoading } = useConfigVersions();
  const createVersion = useCreateConfigVersion();
  const [description, setDescription] = useState("");
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [showCompare, setShowCompare] = useState(false);

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const versionA = versions?.find((v) => v.id === compareA);
  const versionB = versions?.find((v) => v.id === compareB);

  const getComparisonKeys = () => {
    if (!versionA || !versionB) return [];
    const snapshotA = versionA.config_snapshot as Record<string, any>;
    const snapshotB = versionB.config_snapshot as Record<string, any>;
    const allCategories = new Set([...Object.keys(snapshotA || {}), ...Object.keys(snapshotB || {})]);
    const rows: { category: string; key: string; valueA: string; valueB: string; status: string }[] = [];

    for (const cat of allCategories) {
      const keysA = Object.keys(snapshotA?.[cat] || {});
      const keysB = Object.keys(snapshotB?.[cat] || {});
      const allKeys = new Set([...keysA, ...keysB]);

      for (const key of allKeys) {
        const valA = JSON.stringify(snapshotA?.[cat]?.[key] ?? null);
        const valB = JSON.stringify(snapshotB?.[cat]?.[key] ?? null);
        let status = "equal";
        if (valA !== valB) status = "changed";
        if (!snapshotA?.[cat]?.[key] && snapshotB?.[cat]?.[key]) status = "added";
        if (snapshotA?.[cat]?.[key] && !snapshotB?.[cat]?.[key]) status = "removed";
        rows.push({ category: cat, key, valueA: valA, valueB: valB, status });
      }
    }
    return rows.filter((r) => r.status !== "equal");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <Input
          placeholder="Descrição da versão (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full sm:max-w-xs"
        />
        <Button
          onClick={() => {
            createVersion.mutate(description);
            setDescription("");
          }}
          disabled={createVersion.isPending}
          size="sm"
        >
          <Plus className="h-4 w-4 mr-1" /> Criar Snapshot
        </Button>
      </div>

      {(versions || []).length > 0 && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Comparar Versões</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
              <div className="space-y-1">
                <Label className="text-xs">Versão A</Label>
                <Select value={compareA} onValueChange={setCompareA}>
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        #{v.version_number} — {format(new Date(v.created_at), "dd/MM HH:mm")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Versão B</Label>
                <Select value={compareB} onValueChange={setCompareB}>
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        #{v.version_number} — {format(new Date(v.created_at), "dd/MM HH:mm")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!compareA || !compareB || compareA === compareB}
                onClick={() => setShowCompare(true)}
              >
                <Eye className="h-4 w-4 mr-1" /> Comparar
              </Button>
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Ambiente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions?.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-sm">{v.version_number}</TableCell>
                  <TableCell className="text-xs">
                    {format(new Date(v.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-xs">{v.description || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{v.environment}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {(versions || []).length === 0 && (
        <p className="text-sm text-muted-foreground py-4">Nenhuma versão criada ainda. Clique em "Criar Snapshot" para salvar o estado atual.</p>
      )}

      <Dialog open={showCompare} onOpenChange={setShowCompare}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Comparação de Versões</DialogTitle>
            <DialogDescription>
              #{versionA?.version_number} vs #{versionB?.version_number}
            </DialogDescription>
          </DialogHeader>
          {compareA && compareB && (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Chave</TableHead>
                  <TableHead>Versão A</TableHead>
                  <TableHead>Versão B</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {getComparisonKeys().map((row, i) => (
                  <TableRow key={i}>
                    <TableCell><Badge variant="outline">{row.category}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{row.key}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{row.valueA}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{row.valueB}</TableCell>
                    <TableCell>
                      <Badge
                        variant={row.status === "added" ? "default" : row.status === "removed" ? "destructive" : "secondary"}
                      >
                        {row.status === "added" ? "Adicionado" : row.status === "removed" ? "Removido" : "Alterado"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {getComparisonKeys().length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Nenhuma diferença encontrada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Rollback Sub-tab ──
function RollbackTab() {
  const { data: versions, isLoading: versionsLoading } = useConfigVersions();
  const { data: events, isLoading: eventsLoading } = useRollbackEvents();
  const { data: auditSettings } = useGlobalSettings("audit");
  const rollback = useRollbackToVersion();
  const [selectedVersion, setSelectedVersion] = useState("");
  const [justification, setJustification] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const requireDouble = auditSettings?.find((s) => s.key === "require_double_confirmation_prod")?.value === true;
  const rollbackEnabled = auditSettings?.find((s) => s.key === "rollback_enabled")?.value === true;
  const version = versions?.find((v) => v.id === selectedVersion);

  const canRollback = rollbackEnabled && selectedVersion && justification.trim().length > 0;
  const needsConfirm = requireDouble;

  const handleRollback = () => {
    rollback.mutate(
      { versionId: selectedVersion, justification },
      {
        onSuccess: () => {
          setSelectedVersion("");
          setJustification("");
          setConfirmText("");
          setDialogOpen(false);
        },
      }
    );
  };

  if (versionsLoading || eventsLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {!rollbackEnabled && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">Rollback está desativado. Ative em "Controles" para usar esta funcionalidade.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Restaurar Versão</CardTitle>
          <CardDescription>Selecione uma versão para restaurar o estado do CrossConfig.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={selectedVersion} onValueChange={setSelectedVersion} disabled={!rollbackEnabled}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione uma versão" />
            </SelectTrigger>
            <SelectContent>
              {versions?.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  #{v.version_number} — {v.description || format(new Date(v.created_at), "dd/MM/yyyy HH:mm")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Justificativa obrigatória para o rollback..."
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            disabled={!rollbackEnabled}
          />
          {needsConfirm ? (
            <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button disabled={!canRollback} variant="destructive">
                  <RotateCcw className="h-4 w-4 mr-1" /> Restaurar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmação de Rollback</AlertDialogTitle>
                  <AlertDialogDescription>
                    Você está restaurando para a versão #{version?.version_number}. 
                    Digite <strong>CONFIRMAR</strong> para prosseguir.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  placeholder="Digite CONFIRMAR"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={confirmText !== "CONFIRMAR" || rollback.isPending}
                    onClick={handleRollback}
                  >
                    {rollback.isPending ? "Restaurando..." : "Confirmar Rollback"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button disabled={!canRollback || rollback.isPending} variant="destructive" onClick={handleRollback}>
              <RotateCcw className="h-4 w-4 mr-1" /> {rollback.isPending ? "Restaurando..." : "Restaurar"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Histórico de Rollbacks</CardTitle>
        </CardHeader>
        <CardContent>
          {(events || []).length > 0 ? (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Versão Restaurada</TableHead>
                  <TableHead>Justificativa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events?.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">
                      {format(new Date(e.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.restored_version_id.slice(0, 8)}...</TableCell>
                    <TableCell className="text-xs max-w-[300px]">{e.justification}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum rollback realizado.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Controls Sub-tab ──
function ControlsTab() {
  const { data: settings, isLoading } = useGlobalSettings("audit");
  const updateSetting = useUpdateSetting();
  const [pendingToggle, setPendingToggle] = useState<{ key: string; label: string; newValue: boolean } | null>(null);

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const CRITICAL_KEYS = ["audit_enabled", "rollback_enabled", "environment_lock"];

  const controls = [
    { key: "audit_enabled", label: "Auditoria Global", desc: "Kill switch — desativa toda auditoria." },
    { key: "require_justification", label: "Justificativa Obrigatória", desc: "Exige justificativa em alterações de configuração." },
    { key: "require_double_confirmation_prod", label: "Confirmação Dupla (Produção)", desc: "Requer confirmação reforçada para alterações em produção." },
    { key: "rollback_enabled", label: "Rollback Habilitado", desc: "Permite restaurar versões anteriores do CrossConfig." },
    { key: "environment_lock", label: "Bloqueio de Ambiente", desc: "Quando ativo, bloqueia alterações em produção." },
  ];

  const handleToggle = (key: string, label: string, newValue: boolean) => {
    if (CRITICAL_KEYS.includes(key)) {
      setPendingToggle({ key, label, newValue });
    } else {
      updateSetting.mutate({ category: "audit", key, value: newValue });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {controls.map((ctrl) => {
          const setting = settings?.find((s) => s.key === ctrl.key);
          const enabled = setting?.value === true;
          const isCritical = CRITICAL_KEYS.includes(ctrl.key);

          return (
            <Card key={ctrl.key} className={isCritical ? "border-destructive/30" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      {isCritical && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                      <Label className="font-medium">{ctrl.label}</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">{ctrl.desc}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => handleToggle(ctrl.key, ctrl.label, checked)}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <DoubleConfirmDialog
        open={!!pendingToggle}
        onOpenChange={(open) => { if (!open) setPendingToggle(null); }}
        title={`Alterar "${pendingToggle?.label}"`}
        description={`Você está alterando um controle crítico de governança para ${pendingToggle?.newValue ? "ATIVO" : "INATIVO"}. Esta ação impacta toda a rede.`}
        confirmWord="CONFIRMAR"
        onConfirm={() => {
          if (pendingToggle) {
            updateSetting.mutate({ category: "audit", key: pendingToggle.key, value: pendingToggle.newValue });
          }
        }}
      />
    </div>
  );
}

// ── Main ConfigAuditTab ──
export function ConfigAuditTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" /> Auditoria de Configurações
        </CardTitle>
        <CardDescription>
          Versionamento, comparação, rollback e controles globais do CrossConfig.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="timeline" className="space-y-4">
          <TabsList>
            <TabsTrigger value="timeline" className="gap-1">
              <Clock className="h-3.5 w-3.5" /> Linha do Tempo
            </TabsTrigger>
            <TabsTrigger value="versions" className="gap-1">
              <GitBranch className="h-3.5 w-3.5" /> Versões
            </TabsTrigger>
            <TabsTrigger value="rollback" className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Rollback
            </TabsTrigger>
            <TabsTrigger value="controls" className="gap-1">
              <Shield className="h-3.5 w-3.5" /> Controles
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline"><TimelineTab /></TabsContent>
          <TabsContent value="versions"><VersionsTab /></TabsContent>
          <TabsContent value="rollback"><RollbackTab /></TabsContent>
          <TabsContent value="controls"><ControlsTab /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
