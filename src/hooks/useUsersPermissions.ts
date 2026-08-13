import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export interface AdminUser {
  role_id: string;
  user_id: string;
  role: AppRole;
  scope_access: string;
  unit_id: string | null;
  unit_name: string | null;
  created_at: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
}

const ADMIN_ROLES: AppRole[] = ["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin"];

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_users");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        role_id: r.role_id,
        user_id: r.user_id,
        role: r.role,
        scope_access: r.scope_access ?? "global",
        unit_id: r.unit_id ?? null,
        unit_name: r.unit_name ?? null,
        created_at: r.created_at,
        full_name: r.full_name ?? "Sem nome",
        email: r.email ?? null,
        is_active: r.is_active ?? true,
      } as AdminUser));
    },
  });
}

export function useSearchProfiles(search: string, filterUnitIds?: string[]) {
  return useQuery({
    queryKey: ["search-profiles", search, filterUnitIds],
    queryFn: async () => {
      if (!search || search.length < 2) return [];

      // If scoped to specific units, first resolve allowed user_ids
      let allowedUserIds: string[] | null = null;
      if (filterUnitIds && filterUnitIds.length > 0) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("unit_id", filterUnitIds);
        allowedUserIds = [...new Set((roles ?? []).map((r: any) => r.user_id))];
        if (allowedUserIds.length === 0) return [];
      }

      let query = supabase
        .from("profiles")
        .select("id, full_name, email, is_active, city, state")
        .or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);

      if (allowedUserIds) {
        query = query.in("id", allowedUserIds);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: search.length >= 2,
  });
}

export function useUnitsForSelect() {
  return useQuery({
    queryKey: ["units-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id, name, city, state")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUserExistingUnits(userId: string | null) {
  return useQuery({
    queryKey: ["user-existing-units", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("role, unit_id")
        .eq("user_id", userId!)
        .not("unit_id", "is", null);
      if (error) throw error;
      if (!roles?.length) return [];

      const unitIds = [...new Set(roles.map((r: any) => r.unit_id))];
      const { data: unitRows } = await supabase
        .from("units")
        .select("id, name, city, state")
        .in("id", unitIds);
      const unitMap = new Map((unitRows ?? []).map((u: any) => [u.id, u]));

      return roles.map((r: any) => {
        const unit = unitMap.get(r.unit_id);
        return {
          role: r.role as string,
          unit_id: r.unit_id as string,
          unit_name: unit?.name ?? "Unidade",
          city: unit?.city ?? null,
          state: unit?.state ?? null,
        };
      });
    },
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      user_id,
      role,
      scope_access,
      unit_id,
    }: {
      user_id: string;
      role: AppRole;
      scope_access: string;
      unit_id?: string | null;
    }) => {
      // Prevent duplicate (user_id, role, unit_id) bindings
      let dupQuery = supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .eq("role", role);
      dupQuery = unit_id ? dupQuery.eq("unit_id", unit_id) : dupQuery.is("unit_id", null);
      const { data: existing } = await dupQuery.maybeSingle();
      if (existing) {
        throw new Error("Vínculo já existe para este usuário/role/unidade.");
      }

      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id, role, scope_access, unit_id: unit_id || null });
      if (error) throw error;

      await supabase.from("activity_logs").insert({
        user_id: user?.id,
        action: `role_assigned:${role}`,
        module: "usuarios_permissoes",
        details: { target_user_id: user_id, role, scope_access, unit_id: unit_id || null },
      });

      // Log to access_logs
      await supabase.from("access_logs").insert({
        user_id: user?.id,
        event_type: "permission_change",
        module_name: "usuarios_permissoes",
        device_info: JSON.stringify({ action: "role_assigned", target_user_id: user_id, role }),
        success: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export function useRemoveRole() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      role_id,
      target_user_id,
      role,
      reason,
    }: {
      role_id: string;
      target_user_id: string;
      role: string;
      reason?: string;
    }) => {
      // Last admin protection
      if (role === "admin") {
        const { count } = await supabase
          .from("user_roles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin");
        if ((count ?? 0) <= 1) {
          throw new Error("Não é possível remover o último administrador do sistema.");
        }
      }

      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("id", role_id);
      if (error) throw error;

      await supabase.from("activity_logs").insert({
        user_id: user?.id,
        action: `role_removed:${role}`,
        module: "usuarios_permissoes",
        details: { target_user_id, role, reason: reason || null },
      });

      // Log to access_logs
      await supabase.from("access_logs").insert({
        user_id: user?.id,
        event_type: "permission_change",
        module_name: "usuarios_permissoes",
        device_info: JSON.stringify({ action: "role_removed", target_user_id, role, reason }),
        success: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export function useUpdateScope() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      role_id,
      scope_access,
      unit_id,
      target_user_id,
    }: {
      role_id: string;
      scope_access: string;
      unit_id?: string | null;
      target_user_id: string;
    }) => {
      // Carrega o vínculo atual para conhecer user_id + role
      const { data: current, error: curErr } = await supabase
        .from("user_roles")
        .select("user_id, role, unit_id")
        .eq("id", role_id)
        .maybeSingle();
      if (curErr) throw curErr;
      if (!current) throw new Error("Vínculo não encontrado.");

      const newUnitId = unit_id || null;

      // Se o (user_id, role, unit_id) alvo já existe em OUTRA linha → conflito
      let dup = supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", current.user_id)
        .eq("role", current.role)
        .neq("id", role_id);
      dup = newUnitId ? dup.eq("unit_id", newUnitId) : dup.is("unit_id", null);
      const { data: existingDup } = await dup.maybeSingle();
      if (existingDup) {
        throw new Error(
          "Este usuário já possui vínculo com essa unidade nesse perfil. Remova o vínculo duplicado antes de continuar."
        );
      }

      const { error } = await supabase
        .from("user_roles")
        .update({ scope_access, unit_id: newUnitId })
        .eq("id", role_id);
      if (error) {
        if ((error as any).code === "23505") {
          throw new Error(
            "Este usuário já possui vínculo com essa unidade nesse perfil. Remova o vínculo duplicado antes de continuar."
          );
        }
        throw error;
      }

      await supabase.from("activity_logs").insert({
        user_id: user?.id,
        action: "scope_updated",
        module: "usuarios_permissoes",
        details: { target_user_id, scope_access, unit_id: unit_id || null },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export function useChangeRole() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      role_id,
      user_id,
      old_role,
      new_role,
      scope_access,
      unit_id,
    }: {
      role_id: string;
      user_id: string;
      old_role: AppRole;
      new_role: AppRole;
      scope_access: string;
      unit_id?: string | null;
    }) => {
      // Delete ALL existing rows of the OLD role for this user (handles historical
      // duplicates and multiple unit bindings under the same role).
      const { data: deletedRows, error: delError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", user_id)
        .eq("role", old_role)
        .select("id");
      if (delError) throw delError;

      // Avoid creating a duplicate of the NEW role (user_id, role, unit_id)
      const { data: existing } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .eq("role", new_role)
        .is("unit_id", unit_id ? (undefined as any) : null);

      let alreadyExists = false;
      if (unit_id) {
        const { data: existingUnit } = await supabase
          .from("user_roles")
          .select("id")
          .eq("user_id", user_id)
          .eq("role", new_role)
          .eq("unit_id", unit_id)
          .maybeSingle();
        alreadyExists = !!existingUnit;
      } else {
        alreadyExists = !!(existing && existing.length > 0);
      }

      if (!alreadyExists) {
        const { error: insError } = await supabase
          .from("user_roles")
          .insert({ user_id, role: new_role, scope_access, unit_id: unit_id || null });
        if (insError) throw insError;
      }

      await supabase.from("activity_logs").insert({
        user_id: user?.id,
        action: `role_changed:${old_role}:${new_role}`,
        module: "usuarios_permissoes",
        details: {
          target_user_id: user_id,
          old_role,
          new_role,
          scope_access,
          unit_id: unit_id || null,
          removed_old_rows: deletedRows?.length ?? 0,
          new_role_already_existed: alreadyExists,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export function useToggleUserActive() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      target_user_id,
      is_active,
      reason,
      user_status,
      reactivation_date,
    }: {
      target_user_id: string;
      is_active: boolean;
      reason?: string;
      user_status?: string;
      reactivation_date?: string | null;
    }) => {
      // Build update payload for candidates table (source of truth)
      const updatePayload: Record<string, any> = { is_active };
      if (user_status) updatePayload.user_status = user_status;
      if (reason) updatePayload.status_reason = reason;
      if (reactivation_date !== undefined) updatePayload.reactivation_date = reactivation_date;

      const { error } = await supabase
        .from("candidates")
        .update(updatePayload)
        .eq("id", target_user_id);
      if (error) throw error;

      // Also update profiles table (source of truth for admin users)
      const profilePayload: Record<string, any> = { is_active };
      const { error: profileError } = await supabase
        .from("profiles")
        .update(profilePayload)
        .eq("id", target_user_id);
      if (profileError) console.warn("Failed to update profiles:", profileError);

      // Revoke all active sessions when blocking/suspending user
      if (!is_active) {
        const { data: activeSessions } = await supabase
          .from("identity_sessions")
          .select("id")
          .eq("user_id", target_user_id)
          .eq("status", "active");
        
        if (activeSessions?.length) {
          for (const sess of activeSessions) {
            await supabase.rpc("identity_revoke_session", {
              _session_id: sess.id,
              _reason: `user_${user_status || "blocked"}_by_admin`,
            });
          }
        }
      }

      await supabase.from("activity_logs").insert({
        user_id: user?.id,
        action: is_active ? "user_activated" : "user_deactivated",
        module: "usuarios_permissoes",
        details: { target_user_id, reason: reason || null, user_status: user_status || null, reactivation_date: reactivation_date || null },
      });

      // Log to access_logs for audit trail
      await supabase.from("access_logs").insert({
        user_id: user?.id,
        event_type: is_active ? "user_unblocked" : "user_blocked",
        module_name: "usuarios_permissoes",
        device_info: JSON.stringify({ target_user_id, reason: reason || null, user_status }),
        success: true,
      });

      // Notify admins when user is blocked/suspended/archived (onUserBlocked)
      if (!is_active) {
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("role", ["admin", "rh_franqueadora"] as any)
          .neq("user_id", user?.id || "");

        if (admins?.length) {
          const statusLabel = user_status === "bloqueado" ? "bloqueado" : user_status === "suspenso" ? "suspenso" : user_status === "arquivado" ? "arquivado" : "desativado";
          const notifications = admins.map((a: any) => ({
            event_type: "user_blocked",
            recipient_id: a.user_id,
            channel: "push",
            title: `Usuário ${statusLabel}`,
            body: `Um usuário foi ${statusLabel}. Motivo: ${reason || "Não informado"}`,
            status: "pending",
            action_url: "/admin/usuarios-permissoes",
            action_type: "info",
          }));
          await supabase.from("notifications").insert(notifications);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export function usePermissionsHistory() {
  return useQuery({
    queryKey: ["permissions-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, user_id, action, details, created_at")
        .eq("module", "usuarios_permissoes")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      if (!data || data.length === 0) return [];

      const userIds = [...new Set(data.map((d) => d.user_id).filter(Boolean))] as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        profileMap = new Map(profiles?.map((p) => [p.id, p.full_name]) ?? []);
      }

      return data.map((d) => ({
        ...d,
        actor_name: d.user_id ? profileMap.get(d.user_id) ?? "Desconhecido" : "Sistema",
      }));
    },
  });
}
