import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Building2, ShieldAlert, Plus, X, Upload } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  useChangeRole,
  useUpdateScope,
  useToggleUserActive,
  useRemoveRole,
  useUnitsForSelect,
  useAssignRole,
  useAdminUsers,
  type AdminUser,
} from "@/hooks/useUsersPermissions";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  rh_franqueadora: "Admin Franquia",
  gestor_recrutamento: "Gestor Recrutamento",
  franqueado: "Franqueado",
  auditor_admin: "Auditor",
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

const STATUS_OPTIONS = [
  { value: "ativo", label: "Ativo", color: "bg-emerald-100 text-emerald-800" },
  { value: "suspenso", label: "Suspenso", color: "bg-amber-100 text-amber-800" },
  { value: "bloqueado", label: "Bloqueado", color: "bg-destructive/10 text-destructive" },
  { value: "arquivado", label: "Arquivado", color: "bg-muted text-muted-foreground" },
];

const ASSIGNABLE_ROLES: AppRole[] = ["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin"];

interface UserSettingsDialogProps {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserSettingsDialog({ user, open, onOpenChange }: UserSettingsDialogProps) {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const { data: allUnits = [] } = useUnitsForSelect();
  const units = isSuperAdmin ? allUnits : allUnits.filter((u) => myUnitIds.includes(u.id));
  const allowedRoles = isSuperAdmin
    ? ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES.filter((r) => r !== "admin" && r !== "auditor_admin");
  const { data: allAdminUsers = [] } = useAdminUsers();
  const changeRoleMut = useChangeRole();
  const updateScopeMut = useUpdateScope();
  const toggleActiveMut = useToggleUserActive();
  const removeRoleMut = useRemoveRole();
  const assignRoleMut = useAssignRole();

  const [newRole, setNewRole] = useState<AppRole | "">("");
  const [newScope, setNewScope] = useState("");
  const [newUnitId, setNewUnitId] = useState("");
  const [addUnitId, setAddUnitId] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const [showRemove, setShowRemove] = useState(false);
  
  // Status management
  const [selectedStatus, setSelectedStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [reactivationDate, setReactivationDate] = useState("");
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  
  // Signature upload
  const [uploadingSignature, setUploadingSignature] = useState(false);

  // DoubleConfirm states
  const [showRoleConfirm, setShowRoleConfirm] = useState(false);
  const [showScopeConfirm, setShowScopeConfirm] = useState(false);

  const resetState = () => {
    setNewRole("");
    setNewScope("");
    setNewUnitId("");
    setAddUnitId("");
    setRemoveReason("");
    setShowRemove(false);
    setSelectedStatus("");
    setStatusReason("");
    setReactivationDate("");
    setShowStatusConfirm(false);
    setShowRoleConfirm(false);
    setShowScopeConfirm(false);
  };

  if (!user) return null;

  const currentUserStatus = user.is_active ? "ativo" : "bloqueado";

  const handleChangeRole = async () => {
    if (!newRole || newRole === user.role) return;
    try {
      await changeRoleMut.mutateAsync({
        role_id: user.role_id,
        user_id: user.user_id,
        old_role: user.role,
        new_role: newRole,
        scope_access: user.scope_access,
        unit_id: user.unit_id,
      });
      toast.success(`Role alterada para ${ROLE_LABELS[newRole]}`);
      setNewRole("");
      setShowRoleConfirm(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao alterar role");
    }
  };

  const handleUpdateScope = async () => {
    const scope = newScope || user.scope_access;
    const unitId = scope === "unidade" ? newUnitId || user.unit_id : null;
    try {
      await updateScopeMut.mutateAsync({
        role_id: user.role_id,
        scope_access: scope,
        unit_id: unitId,
        target_user_id: user.user_id,
      });
      toast.success("Escopo atualizado");
      setNewScope("");
      setNewUnitId("");
      setShowScopeConfirm(false);
    } catch (e: any) {
      console.error("[updateScope]", e);
      toast.error(e?.message || "Erro ao atualizar escopo");
    }
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    if (status !== "ativo" && status !== currentUserStatus) {
      // Require confirmation for non-ativo status
    } else if (status === "ativo" && !user.is_active) {
      // Reactivating
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!selectedStatus) return;
    const isActivating = selectedStatus === "ativo";
    
    if (!isActivating && !statusReason.trim()) {
      toast.error("Informe o motivo da alteração de status");
      return;
    }

    try {
      await toggleActiveMut.mutateAsync({
        target_user_id: user.user_id,
        is_active: isActivating,
        reason: statusReason.trim() || undefined,
        user_status: selectedStatus,
        reactivation_date: selectedStatus === "suspenso" && reactivationDate ? reactivationDate : null,
      });
      const statusLabel = STATUS_OPTIONS.find(s => s.value === selectedStatus)?.label || selectedStatus;
      toast.success(`Status alterado para ${statusLabel}`);
      setSelectedStatus("");
      setStatusReason("");
      setReactivationDate("");
      setShowStatusConfirm(false);
    } catch {
      toast.error("Erro ao alterar status");
    }
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo 2MB.");
      return;
    }

    setUploadingSignature(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `signatures/${user.user_id}.${ext}`;
      
      const { error: uploadError } = await supabase.storage
        .from("admin-signatures")
        .upload(path, file, { upsert: true });
      
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("admin-signatures")
        .getPublicUrl(path);

      await supabase
        .from("candidates")
        .update({ signature_url: urlData.publicUrl })
        .eq("id", user.user_id);

      // Also update profiles (source of truth)
      await supabase
        .from("profiles")
        .update({ signature_url: urlData.publicUrl })
        .eq("id", user.user_id);

      toast.success("Assinatura digital enviada com sucesso");
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar assinatura");
    } finally {
      setUploadingSignature(false);
    }
  };

  const handleRemoveRole = async () => {
    try {
      await removeRoleMut.mutateAsync({
        role_id: user.role_id,
        target_user_id: user.user_id,
        role: user.role,
        reason: removeReason,
      });
      toast.success("Role removida com sucesso");
      onOpenChange(false);
      resetState();
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover role");
    }
  };

  const currentScope = newScope || user.scope_access;
  const pendingStatus = selectedStatus && selectedStatus !== currentUserStatus;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetState(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Definições do Usuário</DialogTitle>
          <DialogDescription>
            {user.full_name} {user.email ? `• ${user.email}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Current info */}
          <div className="flex flex-wrap gap-2">
            <Badge className={ROLE_COLORS[user.role] ?? ""}>{ROLE_LABELS[user.role]}</Badge>
            <Badge variant="outline">{SCOPE_LABELS[user.scope_access] ?? user.scope_access}</Badge>
            {user.unit_name && <Badge variant="outline">{user.unit_name}</Badge>}
            <Badge variant={user.is_active ? "default" : "destructive"}>
              {user.is_active ? "Ativo" : "Inativo"}
            </Badge>
          </div>

          <Separator />

          {/* Change Role */}
          <div className="space-y-2">
            <Label className="font-semibold">Alterar Role</Label>
            <div className="flex gap-2">
              <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={ROLE_LABELS[user.role]} />
                </SelectTrigger>
                <SelectContent>
                  {allowedRoles.filter((r) => r !== user.role).map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => setShowRoleConfirm(true)}
                disabled={!newRole || newRole === user.role || changeRoleMut.isPending}
              >
                {changeRoleMut.isPending ? "..." : "Salvar"}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Change Scope */}
          <div className="space-y-2">
            <Label className="font-semibold">Escopo de Acesso</Label>
            <div className="space-y-2">
              <Select value={currentScope} onValueChange={(v) => { setNewScope(v); if (v !== "unidade") setNewUnitId(""); }} disabled={!isSuperAdmin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {isSuperAdmin && <SelectItem value="global">Global</SelectItem>}
                  {isSuperAdmin && <SelectItem value="rede">Rede</SelectItem>}
                  {isSuperAdmin && <SelectItem value="regional">Regional</SelectItem>}
                  <SelectItem value="unidade">Unidade</SelectItem>
                </SelectContent>
              </Select>
              {currentScope === "unidade" && (
                <div>
                  <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> Unidade Vinculada</Label>
                  <Select value={newUnitId || user.unit_id || ""} onValueChange={setNewUnitId}>
                    <SelectTrigger><SelectValue placeholder="Selecionar unidade..." /></SelectTrigger>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name} {u.city ? `• ${u.city}` : ""} {u.state ? `- ${u.state}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowScopeConfirm(true)}
                disabled={updateScopeMut.isPending || (!newScope && !newUnitId)}
              >
                {updateScopeMut.isPending ? "Salvando..." : "Atualizar Escopo"}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Multi-unit management */}
          {(user.role === "franqueado" || user.role === "gestor_recrutamento" || user.role === "rh_franqueadora") && (() => {
            const userUnits = allAdminUsers.filter(
              (u) => u.user_id === user.user_id && u.role === user.role && u.unit_id
            );
            const assignedUnitIds = userUnits.map((u) => u.unit_id!);
            const availableUnits = units.filter((u) => !assignedUnitIds.includes(u.id));

            return (
              <div className="space-y-2">
                <Label className="font-semibold flex items-center gap-1">
                  <Building2 className="h-4 w-4" /> Unidades Vinculadas
                </Label>
                {userUnits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma unidade vinculada.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {userUnits.map((uu) => (
                      <Badge key={uu.role_id} variant="secondary" className="text-xs gap-1">
                        {uu.unit_name}
                        {userUnits.length > 1 && (
                          <button
                            className="ml-1 hover:text-destructive"
                            onClick={async () => {
                              try {
                                await removeRoleMut.mutateAsync({
                                  role_id: uu.role_id,
                                  target_user_id: uu.user_id,
                                  role: uu.role,
                                  reason: "Unidade removida",
                                });
                                toast.success(`Unidade ${uu.unit_name} removida`);
                              } catch {
                                toast.error("Erro ao remover unidade");
                              }
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                )}
                {availableUnits.length > 0 && (
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">Adicionar unidade</Label>
                      <Select value={addUnitId} onValueChange={setAddUnitId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar unidade..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} {u.city ? `• ${u.city}` : ""} {u.state ? `- ${u.state}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!addUnitId || assignRoleMut.isPending}
                      onClick={async () => {
                        try {
                          await assignRoleMut.mutateAsync({
                            user_id: user.user_id,
                            role: user.role,
                            scope_access: "unidade",
                            unit_id: addUnitId,
                          });
                          toast.success("Unidade adicionada");
                          setAddUnitId("");
                        } catch (e: any) {
                          toast.error(e.message?.includes("duplicate") ? "Unidade já vinculada" : "Erro ao adicionar unidade");
                        }
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {assignRoleMut.isPending ? "..." : "Adicionar"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}

          <Separator />

          {/* Status Management - Full enum: ativo/suspenso/bloqueado/arquivado */}
          <div className="space-y-3">
            <Label className="font-semibold">Status do Usuário</Label>
            <Select value={selectedStatus || currentUserStatus} onValueChange={handleStatusChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <span className={`inline-flex items-center gap-2`}>
                      <span className={`inline-block w-2 h-2 rounded-full ${s.value === "ativo" ? "bg-emerald-500" : s.value === "suspenso" ? "bg-amber-500" : s.value === "bloqueado" ? "bg-destructive" : "bg-muted-foreground"}`} />
                      {s.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Reactivation date for suspenso */}
            {(selectedStatus === "suspenso") && (
              <div className="space-y-1.5 animate-fade-in">
                <Label className="text-xs">Data de Reativação</Label>
                <Input
                  type="date"
                  value={reactivationDate}
                  onChange={(e) => setReactivationDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>
            )}

            {/* Reason required for non-ativo */}
            {pendingStatus && selectedStatus !== "ativo" && (
              <div className="space-y-1.5 animate-fade-in">
                <Label className="text-xs">Motivo (obrigatório)</Label>
                <Textarea
                  placeholder="Informe o motivo da alteração..."
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  rows={2}
                />
              </div>
            )}

            {pendingStatus && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setSelectedStatus(""); setStatusReason(""); setReactivationDate(""); }}
                >
                  Cancelar
                </Button>
                <Button
                  variant={selectedStatus === "ativo" ? "default" : "destructive"}
                  size="sm"
                  onClick={() => setShowStatusConfirm(true)}
                  disabled={
                    toggleActiveMut.isPending ||
                    (selectedStatus !== "ativo" && !statusReason.trim())
                  }
                >
                  {toggleActiveMut.isPending ? "Salvando..." : `Alterar para ${STATUS_OPTIONS.find(s => s.value === selectedStatus)?.label}`}
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* Signature Upload */}
          <div className="space-y-2">
            <Label className="font-semibold flex items-center gap-1">
              <Upload className="h-4 w-4" /> Assinatura Digital
            </Label>
            <p className="text-xs text-muted-foreground">Upload de imagem da assinatura (PNG, JPG — máx 2MB)</p>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleSignatureUpload}
              disabled={uploadingSignature}
              className="text-xs"
            />
            {uploadingSignature && <p className="text-xs text-muted-foreground">Enviando...</p>}
          </div>

          <Separator />

          {/* Remove Role */}
          <div className="space-y-2">
            {!showRemove ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setShowRemove(true)}
              >
                <ShieldAlert className="h-4 w-4 mr-1" />
                Remover Acesso Administrativo
              </Button>
            ) : (
              <div className="space-y-2 border border-destructive/30 rounded-md p-3">
                <p className="text-sm font-medium text-destructive">
                  Remover role {ROLE_LABELS[user.role]} de {user.full_name}?
                </p>
                <Textarea
                  placeholder="Motivo da remoção (opcional)..."
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setShowRemove(false); setRemoveReason(""); }}>
                    Cancelar
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleRemoveRole} disabled={removeRoleMut.isPending}>
                    {removeRoleMut.isPending ? "Removendo..." : "Confirmar Remoção"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>

      {/* DoubleConfirm for role change */}
      <DoubleConfirmDialog
        open={showRoleConfirm}
        onOpenChange={setShowRoleConfirm}
        title="Confirmar alteração de role"
        description={`Alterar role de ${user.full_name} de "${ROLE_LABELS[user.role]}" para "${ROLE_LABELS[newRole as string] || newRole}"?`}
        confirmWord="CONFIRMAR"
        confirmLabel="Confirmar alteração"
        onConfirm={handleChangeRole}
      />

      {/* DoubleConfirm for scope change */}
      <DoubleConfirmDialog
        open={showScopeConfirm}
        onOpenChange={setShowScopeConfirm}
        title="Confirmar alteração de escopo"
        description={`Alterar escopo de ${user.full_name} para "${SCOPE_LABELS[newScope || user.scope_access] || newScope}"?`}
        confirmWord="CONFIRMAR"
        confirmLabel="Confirmar alteração"
        onConfirm={handleUpdateScope}
      />

      {/* DoubleConfirm for status change */}
      <DoubleConfirmDialog
        open={showStatusConfirm}
        onOpenChange={setShowStatusConfirm}
        title="Confirmar alteração de status"
        description={`Alterar status de ${user.full_name} para "${STATUS_OPTIONS.find(s => s.value === selectedStatus)?.label}"? ${statusReason ? `Motivo: ${statusReason}` : ""}`}
        confirmWord="CONFIRMAR"
        confirmLabel="Confirmar alteração"
        onConfirm={handleConfirmStatusChange}
      />
    </Dialog>
  );
}
