import { useState, useEffect } from "react";
import { CSVUserImportDialog } from "@/components/admin/CSVUserImportDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { Users, ShieldCheck, UserPlus, Search, Eye, Pencil, CheckCircle, XCircle, Settings, Building2, Plus, X, Download, AlertTriangle, Globe, Activity, Upload } from "lucide-react";
import {
  useAdminUsers,
  useSearchProfiles,
  useAssignRole,
  useUnitsForSelect,
  useUserExistingUnits,
  usePermissionsHistory,
  type AdminUser,
} from "@/hooks/useUsersPermissions";
import { useUserPermissions, useAllPermissions, useUpdatePermission, permissionsToVECAX, type UserPermission } from "@/hooks/usePermissionsDB";
import { useAccessLogs, type AccessLogEntry } from "@/hooks/useAccessLogs";
import { UserSettingsDialog } from "@/components/admin/UserSettingsDialog";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { SecurityAlertsPanel } from "@/components/admin/SecurityAlertsPanel";
import type { Database } from "@/integrations/supabase/types";
import { PageHelp } from "@/components/ui/page-help";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { logSensitiveAccess } from "@/lib/accessLogHelper";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  rh_franqueadora: "Admin Franquia",
  gestor_recrutamento: "Gestor Recrutamento",
  franqueado: "Franqueado",
  auditor_admin: "Auditor",
  candidato: "Candidato",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-destructive text-destructive-foreground",
  rh_franqueadora: "bg-primary text-primary-foreground",
  gestor_recrutamento: "bg-accent text-accent-foreground",
  franqueado: "bg-secondary text-secondary-foreground",
  auditor_admin: "bg-muted text-muted-foreground",
};

const SCOPE_LABELS: Record<string, string> = {
  global: "Global",
  rede: "Rede",
  regional: "Regional",
  unidade: "Unidade",
};

const ASSIGNABLE_ROLES: AppRole[] = ["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin"];

const ACTION_LABELS: Record<string, string> = {
  role_assigned: "Role atribuída",
  role_removed: "Role removida",
  role_changed: "Role alterada",
  scope_updated: "Escopo alterado",
  user_activated: "Usuário ativado",
  user_deactivated: "Usuário desativado",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  failed_login: "Tentativa falha",
  permission_change: "Alteração de permissão",
  user_blocked: "Usuário bloqueado",
  user_unblocked: "Usuário desbloqueado",
  export: "Exportação",
  sensitive_access: "Acesso sensível",
};

const PERM_LEGEND = [
  { key: "V", label: "Ver", icon: Eye },
  { key: "E", label: "Editar", icon: Pencil },
  { key: "C", label: "Criar", icon: CheckCircle },
  { key: "A", label: "Aprovar", icon: CheckCircle },
  { key: "D", label: "Deletar", icon: XCircle },
  { key: "X", label: "Exportar", icon: XCircle },
  { key: "—", label: "Sem acesso", icon: XCircle },
];

function PermCell({ perms }: { perms: string }) {
  if (perms === "—" || !perms) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex gap-0.5">
      {perms.split("").map((p, i) => {
        const colors: Record<string, string> = {
          V: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
          E: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
          C: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
          A: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
          X: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
        };
        return (
          <span key={i} className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${colors[p] ?? ""}`}>
            {p}
          </span>
        );
      })}
    </div>
  );
}

export default function UsersPermissions() {
  const { hasRole, unitIds: myUnitIds, user: authUser } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const { data: adminUsers = [], isLoading } = useAdminUsers();
  const { data: allUnits = [] } = useUnitsForSelect();
  const { data: historyLogs = [], isLoading: historyLoading } = usePermissionsHistory();
  const { data: allPermissions = [] } = useAllPermissions();

  // Log sensitive access on mount
  useEffect(() => {
    if (authUser?.id) logSensitiveAccess("usuarios_permissoes", authUser.id);
  }, [authUser?.id]);

  // Non-admin users only see units they are linked to
  const units = isSuperAdmin ? allUnits : allUnits.filter((u) => myUnitIds.includes(u.id));

  // Non-admin cannot assign/see admin-level roles
  const allowedRoles = isSuperAdmin
    ? ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES.filter((r) => r !== "admin" && r !== "auditor_admin");

  // Filters
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterName, setFilterName] = useState("");

  // History filters
  const [historyFilterUser, setHistoryFilterUser] = useState("");
  const [historyFilterDateFrom, setHistoryFilterDateFrom] = useState("");
  const [historyFilterDateTo, setHistoryFilterDateTo] = useState("");
  const [historyFilterAction, setHistoryFilterAction] = useState("all");

  // Access logs filters
  const [accessFilterUser, setAccessFilterUser] = useState("");
  const [accessFilterEvent, setAccessFilterEvent] = useState("all");
  const [accessFilterModule, setAccessFilterModule] = useState("all");
  const [accessFilterDateFrom, setAccessFilterDateFrom] = useState("");
  const [accessFilterDateTo, setAccessFilterDateTo] = useState("");

  const { data: accessLogs = [], isLoading: accessLoading } = useAccessLogs({
    eventType: accessFilterEvent !== "all" ? accessFilterEvent : undefined,
    moduleName: accessFilterModule !== "all" ? accessFilterModule : undefined,
    dateFrom: accessFilterDateFrom || undefined,
    dateTo: accessFilterDateTo || undefined,
  });

  // Settings dialog
  const [settingsUserRoleId, setSettingsUserRoleId] = useState<string | null>(null);

  // Add access tab
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [assignRole, setAssignRole] = useState<AppRole>("franqueado");
  const [assignScope, setAssignScope] = useState(isSuperAdmin ? "rede" : "unidade");
  const [assignUnitIds, setAssignUnitIds] = useState<string[]>([]);
  const [addingUnitId, setAddingUnitId] = useState<string>("");

  // Permission editing
  const [editingPermUserId, setEditingPermUserId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const updatePermMut = useUpdatePermission();
  const { data: editingUserPerms = [] } = useUserPermissions(editingPermUserId);

  // Double confirm dialog
  const [doubleConfirm, setDoubleConfirm] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const { data: searchResults = [] } = useSearchProfiles(searchTerm, isSuperAdmin ? undefined : myUnitIds);
  const { data: userExistingUnits = [] } = useUserExistingUnits(selectedUserId);
  const assignRoleMut = useAssignRole();

  // Non-admin: only show users that share at least one of "my" units
  const visibleAdminUsers = isSuperAdmin
    ? adminUsers
    : adminUsers.filter((u) => u.unit_id && myUnitIds.includes(u.unit_id));

  // Filtered users — group by user_id to consolidate duplicates
  const filteredRaw = visibleAdminUsers.filter((u) => {
    if (filterRole !== "all" && u.role !== filterRole) return false;
    if (filterStatus === "active" && !u.is_active) return false;
    if (filterStatus === "inactive" && u.is_active) return false;
    if (filterName && !u.full_name.toLowerCase().includes(filterName.toLowerCase())) return false;
    return true;
  });

  // Group by user_id+role to show one row per user/role with all units
  const groupedMap = new Map<string, AdminUser & { extra_units: string[] }>();
  filteredRaw.forEach((u) => {
    const key = `${u.user_id}__${u.role}`;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, { ...u, extra_units: [] });
    } else {
      const existing = groupedMap.get(key)!;
      if (u.unit_name && u.unit_name !== existing.unit_name) {
        existing.extra_units.push(u.unit_name);
      }
    }
  });
  const filtered = Array.from(groupedMap.values());

  // Metrics (scoped to visible users)
  const activeAdmins = visibleAdminUsers.filter((u) => u.is_active);
  const roleCounts = ASSIGNABLE_ROLES.reduce((acc, role) => {
    acc[role] = visibleAdminUsers.filter((u) => u.role === role).length;
    return acc;
  }, {} as Record<string, number>);

  // Existing unit_ids for the selected role (for dedup in dropdown)
  const existingForRole = userExistingUnits.filter((u) => u.role === assignRole);
  const existingUnitIds = existingForRole.map((u) => u.unit_id);

  const isUnitRole = assignRole === "franqueado" || assignRole === "gestor_recrutamento" || assignRole === "rh_franqueadora";

  // Available units: exclude already-assigned + already-selected
  const availableUnits = units.filter(
    (u) => !existingUnitIds.includes(u.id) && !assignUnitIds.includes(u.id)
  );

  // Filtered history logs
  const filteredHistory = historyLogs.filter((l) => {
    if (historyFilterUser && !l.actor_name?.toLowerCase().includes(historyFilterUser.toLowerCase())) return false;
    if (historyFilterAction !== "all") {
      const actionKey = l.action?.split(":")[0] ?? "";
      if (actionKey !== historyFilterAction) return false;
    }
    if (historyFilterDateFrom && l.created_at < historyFilterDateFrom) return false;
    if (historyFilterDateTo && l.created_at > historyFilterDateTo + "T23:59:59") return false;
    return true;
  });

  // Filtered access logs (user name filter applied client-side)
  const filteredAccessLogs = accessFilterUser
    ? accessLogs.filter((l) => l.user_name?.toLowerCase().includes(accessFilterUser.toLowerCase()))
    : accessLogs;

  // Build permissions matrix from DB data
  const uniqueUsers = [...new Map(visibleAdminUsers.map((u) => [u.user_id, u])).values()];
  const modules = [...new Set(allPermissions.map((p) => p.module_name))].sort();

  const handleAssign = async () => {
    if (!selectedUserId) return;
    const needsUnit = isUnitRole || assignScope === "unidade";
    if (needsUnit && assignUnitIds.length === 0) {
      toast.error("Adicione pelo menos uma unidade para esta role.");
      return;
    }
    try {
      if (needsUnit) {
        for (const uid of assignUnitIds) {
          await assignRoleMut.mutateAsync({
            user_id: selectedUserId,
            role: assignRole,
            scope_access: "unidade",
            unit_id: uid,
          });
        }
      } else {
        await assignRoleMut.mutateAsync({
          user_id: selectedUserId,
          role: assignRole,
          scope_access: assignScope,
          unit_id: null,
        });
      }
      toast.success(needsUnit && assignUnitIds.length > 1
        ? `Acesso atribuído em ${assignUnitIds.length} unidades`
        : "Acesso atribuído com sucesso"
      );
      setSelectedUserId(null);
      setSearchTerm("");
      setAssignUnitIds([]);
      setAddingUnitId("");
    } catch (e: any) {
      if (e?.message?.toLowerCase().includes("duplicate")) {
        toast.error("Usuário já possui esta role/unidade");
      } else {
        safeToast.error(e);
      }
    }
  };

  const handlePermToggle = (perm: UserPermission, field: keyof Pick<UserPermission, "can_view" | "can_create" | "can_edit" | "can_delete" | "can_export" | "can_approve" | "can_configure">) => {
    setDoubleConfirm({
      open: true,
      title: "Alterar permissão",
      description: `Confirma alteração de "${field.replace("can_", "")}" para o módulo "${perm.module_name}"?`,
      onConfirm: async () => {
        try {
          await updatePermMut.mutateAsync({
            id: perm.id,
            updates: { [field]: !perm[field] },
            override_reason: overrideReason || undefined,
          });
          toast.success("Permissão atualizada");
          setOverrideReason("");
        } catch {
          toast.error("Erro ao atualizar permissão");
        }
      },
    });
  };

  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const exportCSV = (rows: string[], headers: string, filename: string) => {
    const escapeField = (f: string) => {
      if (f.includes(";") || f.includes('"') || f.includes("\n")) {
        return `"${f.replace(/"/g, '""')}"`;
      }
      return f;
    };
    const headerLine = headers.split(";").map(escapeField).join(";");
    const dataLines = rows.map((r) => r.split(";").map(escapeField).join(";"));
    const csv = "\uFEFF" + [headerLine, ...dataLines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado");
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Usuários e Permissões</h2>
        <PageHelp />
      </div>

      

      <Tabs defaultValue="admin-users">
        <TabsList className="flex-wrap">
          <TabsTrigger value="admin-users" className="gap-1"><Users className="h-4 w-4 shrink-0" /> Usuários Admin</TabsTrigger>
          <TabsTrigger value="add-access" className="gap-1"><UserPlus className="h-4 w-4 shrink-0" /> Adicionar Acesso</TabsTrigger>
          <TabsTrigger value="history" className="gap-1"><Activity className="h-4 w-4 shrink-0" /> Histórico</TabsTrigger>
          <TabsTrigger value="permissions-map" className="gap-1"><ShieldCheck className="h-4 w-4 shrink-0" /> Mapa de Permissões</TabsTrigger>
          <TabsTrigger value="scopes" className="gap-1"><Globe className="h-4 w-4 shrink-0" /> Escopos</TabsTrigger>
          <TabsTrigger value="access-logs" className="gap-1"><Activity className="h-4 w-4 shrink-0" /> Acessos</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1"><AlertTriangle className="h-4 w-4 shrink-0" /> Alertas</TabsTrigger>
        </TabsList>

        {/* ===== TAB: Usuarios ===== */}
        <TabsContent value="admin-users" className="space-y-4">
          {/* Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{activeAdmins.length}</p>
                <p className="text-xs text-muted-foreground">Admins Ativos</p>
              </CardContent>
            </Card>
            {ASSIGNABLE_ROLES.map((role) => (
              <Card key={role}>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{roleCounts[role]}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Add Access moved to its own tab */}

          {/* Filters */}
          <Card>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-2 lg:col-span-1">
                <Label className="text-xs">Buscar por nome</Label>
                <Input placeholder="Nome..." value={filterName} onChange={(e) => setFilterName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Role</Label>
                <Select value={filterRole} onValueChange={setFilterRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent disableSearch>
                    <SelectItem value="all">Todas</SelectItem>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent disableSearch>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Ativos</SelectItem>
                    <SelectItem value="inactive">Inativos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg flex items-center gap-2 min-w-0"><ShieldCheck className="h-5 w-5 shrink-0" /> Usuários Administrativos ({filtered.length})</CardTitle>
              <div className="flex gap-2 shrink-0 flex-wrap">
                <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                  const rows = filtered.map((u) => `${u.full_name};${u.email ?? ""};${ROLE_LABELS[u.role]};${SCOPE_LABELS[u.scope_access] ?? u.scope_access};${u.unit_name ?? ""};${u.is_active ? "Ativo" : "Inativo"}`);
                  exportCSV(rows, "Nome;Email;Role;Escopo;Unidade;Status", "usuarios_admin.csv");
                  try { const { logExportEvent } = await import("@/lib/accessLogHelper"); logExportEvent("usuarios_permissoes", "csv"); } catch {}
                }}>
                  <Download className="h-4 w-4" /> CSV
                </Button>
                <Button size="sm" className="gap-1" onClick={() => setCsvImportOpen(true)}>
                  <Upload className="h-4 w-4" /> Importar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhum usuário encontrado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Escopo</TableHead>
                        <TableHead>Unidades</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((u) => (
                        <TableRow key={`${u.user_id}-${u.role}`}>
                          <TableCell className="font-medium name-display">{u.full_name}</TableCell>
                          <TableCell className="text-muted-foreground">{u.email ?? "—"}</TableCell>
                          <TableCell><Badge className={ROLE_COLORS[u.role] ?? ""}>{ROLE_LABELS[u.role]}</Badge></TableCell>
                          <TableCell><Badge variant="outline">{SCOPE_LABELS[u.scope_access] ?? u.scope_access}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {u.unit_name ? (
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline" className="text-xs">{u.unit_name}</Badge>
                                {u.extra_units.map((name) => (
                                  <Badge key={name} variant="outline" className="text-xs">{name}</Badge>
                                ))}
                              </div>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.is_active ? "default" : "destructive"}>
                              {u.is_active ? "Ativo" : "Inativo"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setSettingsUserRoleId(u.role_id)}>
                              <Settings className="h-4 w-4" />
                              Definições
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

        </TabsContent>

        {/* ===== TAB: Adicionar Acesso ===== */}
        <TabsContent value="add-access" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><UserPlus className="h-5 w-5" /> Adicionar Acesso</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar por nome ou email..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setSelectedUserId(null); setAssignUnitIds([]); setAddingUnitId(""); }} />
              </div>

              {searchResults.length > 0 && (
                <div className="border rounded-md max-h-60 overflow-auto">
                  {searchResults.map((p) => (
                    <div
                      key={p.id}
                      className={`p-3 cursor-pointer hover:bg-muted transition-colors border-b last:border-b-0 ${selectedUserId === p.id ? "bg-muted" : ""}`}
                      onClick={() => { setSelectedUserId(p.id); setAssignUnitIds([]); setAddingUnitId(""); }}
                    >
                      <p className="font-medium text-foreground name-display">{p.full_name}</p>
                      <p className="text-sm text-muted-foreground">{p.email ?? "Sem email"} • {p.city ?? ""} {p.state ? `- ${p.state}` : ""}</p>
                    </div>
                  ))}
                </div>
              )}

              {selectedUserId && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Role</Label>
                      <Select value={assignRole} onValueChange={(v) => {
                        const role = v as AppRole;
                        setAssignRole(role);
                        setAssignUnitIds([]);
                        setAddingUnitId("");
                        if (role === "franqueado" || role === "gestor_recrutamento" || role === "rh_franqueadora") {
                          setAssignScope("unidade");
                        }
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {allowedRoles.map((r) => (
                            <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Escopo</Label>
                      <Select
                        value={assignScope}
                        onValueChange={(v) => { setAssignScope(v); if (v !== "unidade") setAssignUnitIds([]); }}
                        disabled={isUnitRole || !isSuperAdmin}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {isSuperAdmin && <SelectItem value="global">Global</SelectItem>}
                          {isSuperAdmin && <SelectItem value="rede">Rede</SelectItem>}
                          {isSuperAdmin && <SelectItem value="regional">Regional</SelectItem>}
                          <SelectItem value="unidade">Unidade</SelectItem>
                        </SelectContent>
                      </Select>
                      {isUnitRole && (
                        <p className="text-xs text-muted-foreground mt-1">Escopo fixo em Unidade para {ROLE_LABELS[assignRole]}</p>
                      )}
                    </div>
                  </div>

                  {userExistingUnits.length > 0 && (
                    <div className="space-y-1 p-3 rounded-md bg-muted/50 border">
                      <p className="text-xs font-medium text-muted-foreground">Vínculos existentes deste usuário:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {userExistingUnits.map((eu) => (
                          <Badge key={`${eu.role}-${eu.unit_id}`} variant="outline" className="text-xs">
                            <span className="font-semibold mr-1">{ROLE_LABELS[eu.role] ?? eu.role}:</span>
                            {eu.unit_name} {eu.city ? `• ${eu.city}` : ""} {eu.state ? `- ${eu.state}` : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {(assignScope === "unidade" || isUnitRole) && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> Unidades Vinculadas</Label>

                      {existingForRole.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Já vinculadas para {ROLE_LABELS[assignRole]}:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {existingForRole.map((eu) => (
                              <Badge key={eu.unit_id} variant="outline" className="text-xs opacity-60">
                                {eu.unit_name} {eu.city ? `• ${eu.city}` : ""} {eu.state ? `- ${eu.state}` : ""}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {assignUnitIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {assignUnitIds.map((uid) => {
                            const u = units.find((x) => x.id === uid);
                            return (
                              <Badge key={uid} variant="secondary" className="text-xs gap-1">
                                {u ? u.name : uid}
                                <button className="ml-1 hover:text-destructive" onClick={() => setAssignUnitIds((prev) => prev.filter((id) => id !== uid))}>
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            );
                          })}
                        </div>
                      )}

                      {availableUnits.length > 0 && (
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <Select value={addingUnitId} onValueChange={setAddingUnitId}>
                              <SelectTrigger><SelectValue placeholder="Selecionar unidade..." /></SelectTrigger>
                              <SelectContent>
                                {availableUnits.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>{u.name} {u.city ? `• ${u.city}` : ""} {u.state ? `- ${u.state}` : ""}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button size="sm" variant="outline" disabled={!addingUnitId}
                            onClick={() => { if (addingUnitId) { setAssignUnitIds((prev) => [...prev, addingUnitId]); setAddingUnitId(""); } }}
                          >
                            <Plus className="h-4 w-4 mr-1" /> Adicionar
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  <Button onClick={handleAssign} disabled={assignRoleMut.isPending || ((assignScope === "unidade" || isUnitRole) && assignUnitIds.length === 0)}>
                    {assignRoleMut.isPending ? "Atribuindo..." : "Confirmar Atribuição"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: Histórico ===== */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5" /> Histórico de Alterações</CardTitle>
              <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                const rows = filteredHistory.map((log) => `${format(new Date(log.created_at), "dd/MM/yyyy HH:mm")};${log.actor_name};${log.action}`);
                exportCSV(rows, "Data;Ator;Ação", "historico_permissoes.csv");
                try { const { logExportEvent } = await import("@/lib/accessLogHelper"); logExportEvent("usuarios_permissoes", "csv"); } catch {}
              }}>
                <Download className="h-4 w-4" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Input placeholder="Filtrar por ator..." value={historyFilterUser} onChange={(e) => setHistoryFilterUser(e.target.value)} />
                <Select value={historyFilterAction} onValueChange={setHistoryFilterAction}>
                  <SelectTrigger><SelectValue placeholder="Tipo de ação" /></SelectTrigger>
                  <SelectContent disableSearch>
                    <SelectItem value="all">Todas as ações</SelectItem>
                    {Object.entries(ACTION_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="date" value={historyFilterDateFrom} onChange={(e) => setHistoryFilterDateFrom(e.target.value)} />
                <Input type="date" value={historyFilterDateTo} onChange={(e) => setHistoryFilterDateTo(e.target.value)} />
              </div>
              {historyLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
              ) : filteredHistory.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhum registro encontrado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data/Hora</TableHead>
                        <TableHead>Ator</TableHead>
                        <TableHead>Ação</TableHead>
                        <TableHead>Detalhes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHistory.map((log) => {
                        const actionKey = log.action?.split(":")[0] ?? log.action;
                        const actionRole = log.action?.split(":")[1];
                        const details = log.details as Record<string, any> | null;
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="text-sm whitespace-nowrap">{format(new Date(log.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                            <TableCell className="font-medium">{log.actor_name}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{ACTION_LABELS[actionKey] ?? log.action}</Badge>
                              {actionRole && <span className="ml-1 text-xs text-muted-foreground">({ROLE_LABELS[actionRole] ?? actionRole})</span>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                              {details?.reason && <span>Motivo: {details.reason} • </span>}
                              {details?.scope_access && <span>Escopo: {SCOPE_LABELS[details.scope_access] ?? details.scope_access}</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions-map" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Mapa de Permissões VECAX</CardTitle>
              <div className="flex flex-wrap gap-3 pt-2">
                {PERM_LEGEND.map((l) => (
                  <span key={l.key} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="font-bold">{l.key}</span> = {l.label}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground pt-1">Dados carregados da tabela <code>permissions</code>. Clique em um usuário para editar permissões individuais.</p>
            </CardHeader>
            <CardContent>
              {modules.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhuma permissão cadastrada.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[160px]">Módulo</TableHead>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <TableHead key={r} className="text-center min-w-[100px]">{ROLE_LABELS[r]}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modules.map((mod) => (
                        <TableRow key={mod}>
                          <TableCell className="font-medium text-sm">{mod}</TableCell>
                          {ASSIGNABLE_ROLES.map((role) => {
                            // Find first user with this role and get their permission for this module
                            const userWithRole = uniqueUsers.find((u) => u.role === role);
                            const perm = userWithRole
                              ? allPermissions.find((p) => p.user_id === userWithRole.user_id && p.module_name === mod)
                              : undefined;
                            const vecax = perm ? permissionsToVECAX(perm) : "—";
                            return (
                              <TableCell key={role} className="text-center">
                                <PermCell perms={vecax} />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-user permission editor */}
          {isSuperAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Editar Permissões por Usuário</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={editingPermUserId || ""} onValueChange={(v) => { setEditingPermUserId(v || null); setOverrideReason(""); }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar usuário..." /></SelectTrigger>
                  <SelectContent>
                    {uniqueUsers.map((u) => (
                      <SelectItem key={u.user_id} value={u.user_id}>
                        <span className="name-display">{u.full_name}</span> ({ROLE_LABELS[u.role]})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {editingPermUserId && editingUserPerms.length > 0 && (
                  <>
                    <div>
                      <Label className="text-xs">Justificativa para override (obrigatório para alterações)</Label>
                      <Textarea
                        placeholder="Motivo da alteração de permissão..."
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        rows={2}
                      />
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Módulo</TableHead>
                            <TableHead className="text-center">Ver</TableHead>
                            <TableHead className="text-center">Editar</TableHead>
                            <TableHead className="text-center">Criar</TableHead>
                            <TableHead className="text-center">Excluir</TableHead>
                            <TableHead className="text-center">Exportar</TableHead>
                            <TableHead className="text-center">Aprovar</TableHead>
                            <TableHead className="text-center">Configurar</TableHead>
                            <TableHead>Override</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {editingUserPerms.map((perm) => (
                            <TableRow key={perm.id}>
                              <TableCell className="font-medium text-sm">{perm.module_name}</TableCell>
                              {(["can_view", "can_create", "can_edit", "can_delete", "can_export", "can_approve", "can_configure"] as const).map((field) => (
                                <TableCell key={field} className="text-center">
                                  <Switch
                                    checked={perm[field]}
                                    onCheckedChange={() => {
                                      if (!overrideReason) {
                                        toast.error("Informe a justificativa antes de alterar permissões");
                                        return;
                                      }
                                      handlePermToggle(perm, field);
                                    }}
                                    disabled={updatePermMut.isPending}
                                  />
                                </TableCell>
                              ))}
                              <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                                {perm.override_reason || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== TAB: Escopos ===== */}
        <TabsContent value="scopes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Globe className="h-5 w-5" /> Escopos de Acesso</CardTitle>
              <p className="text-xs text-muted-foreground">Visualize e gerencie o escopo de cada administrador. Clique em "Definições" na aba Usuários para alterar.</p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Escopo</TableHead>
                        <TableHead>Unidades</TableHead>
                        <TableHead>Desde</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((u) => (
                        <TableRow key={`${u.user_id}-${u.role}-scope`}>
                          <TableCell className="font-medium name-display">{u.full_name}</TableCell>
                          <TableCell><Badge className={ROLE_COLORS[u.role] ?? ""}>{ROLE_LABELS[u.role]}</Badge></TableCell>
                          <TableCell>
                            <Badge variant="outline" className={u.scope_access === "global" ? "border-primary text-primary" : ""}>
                              {SCOPE_LABELS[u.scope_access] ?? u.scope_access}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {u.unit_name ? (
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline" className="text-xs">{u.unit_name}</Badge>
                                {u.extra_units.map((name) => (
                                  <Badge key={name} variant="outline" className="text-xs">{name}</Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">Todas</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(u.created_at), "dd/MM/yyyy")}
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

        {/* ===== TAB: Acessos (access_logs) ===== */}
        <TabsContent value="access-logs" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5" /> Registro de Acessos</CardTitle>
              <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                const rows = filteredAccessLogs.map((l) =>
                  `${l.created_at ? format(new Date(l.created_at), "dd/MM/yyyy HH:mm") : ""};${l.user_name};${EVENT_TYPE_LABELS[l.event_type] ?? l.event_type};${l.module_name ?? ""};${l.ip_address ?? ""};${l.success ? "Sim" : "Não"}`
                );
                exportCSV(rows, "Data;Usuário;Evento;Módulo;IP;Sucesso", "acessos.csv");
                try { const { logExportEvent } = await import("@/lib/accessLogHelper"); logExportEvent("usuarios_permissoes", "csv"); } catch {}
              }}>
                <Download className="h-4 w-4" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <Input placeholder="Filtrar por usuário..." value={accessFilterUser} onChange={(e) => setAccessFilterUser(e.target.value)} />
                <Select value={accessFilterEvent} onValueChange={setAccessFilterEvent}>
                  <SelectTrigger><SelectValue placeholder="Tipo de evento" /></SelectTrigger>
                  <SelectContent disableSearch>
                    <SelectItem value="all">Todos os eventos</SelectItem>
                    {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={accessFilterModule} onValueChange={setAccessFilterModule}>
                  <SelectTrigger><SelectValue placeholder="Módulo" /></SelectTrigger>
                  <SelectContent disableSearch>
                    <SelectItem value="all">Todos os módulos</SelectItem>
                    <SelectItem value="auth">Auth</SelectItem>
                    <SelectItem value="usuarios_permissoes">Usuários/Permissões</SelectItem>
                    <SelectItem value="configuracoes">Configurações</SelectItem>
                    <SelectItem value="vagas">Vagas</SelectItem>
                    <SelectItem value="documentos">Documentos</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={accessFilterDateFrom} onChange={(e) => setAccessFilterDateFrom(e.target.value)} />
                <Input type="date" value={accessFilterDateTo} onChange={(e) => setAccessFilterDateTo(e.target.value)} />
              </div>

              {accessLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
              ) : filteredAccessLogs.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhum registro de acesso encontrado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data/Hora</TableHead>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Evento</TableHead>
                        <TableHead>Módulo</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Dispositivo</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAccessLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {log.created_at ? format(new Date(log.created_at), "dd/MM/yyyy HH:mm") : "—"}
                          </TableCell>
                          <TableCell className="font-medium">{log.user_name}</TableCell>
                          <TableCell>
                            <Badge variant={log.event_type === "login" ? "default" : log.event_type === "logout" ? "secondary" : log.event_type.includes("block") ? "destructive" : "outline"}>
                              {EVENT_TYPE_LABELS[log.event_type] ?? log.event_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{log.module_name ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{log.ip_address ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{log.device_info?.substring(0, 60) ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={log.success ? "default" : "destructive"} className="text-xs">
                              {log.success ? "OK" : "Falha"}
                            </Badge>
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

        {/* ===== TAB: Alertas ===== */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Alertas de Segurança</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SecurityAlertsPanel historyLogs={historyLogs} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Unified Settings Dialog */}
      <UserSettingsDialog
        user={adminUsers.find((u) => u.role_id === settingsUserRoleId) ?? null}
        open={!!settingsUserRoleId}
        onOpenChange={(o) => !o && setSettingsUserRoleId(null)}
      />

      {/* Double Confirm Dialog for critical actions */}
      <DoubleConfirmDialog
        open={doubleConfirm.open}
        onOpenChange={(o) => setDoubleConfirm((prev) => ({ ...prev, open: o }))}
        title={doubleConfirm.title}
        description={doubleConfirm.description}
        onConfirm={doubleConfirm.onConfirm}
      />

      {/* CSV Import Dialog */}
      <CSVUserImportDialog
        open={csvImportOpen}
        onOpenChange={setCsvImportOpen}
        units={allUnits}
      />
    </div>
  );
}
