import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface UserPermission {
  id: string;
  user_id: string;
  module_name: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  can_approve: boolean;
  can_configure: boolean;
  override_reason: string | null;
}

export function useUserPermissions(userId: string | null) {
  return useQuery({
    queryKey: ["user-permissions", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permissions")
        .select("*")
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []) as UserPermission[];
    },
  });
}

export function useAllPermissions() {
  return useQuery({
    queryKey: ["all-permissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permissions")
        .select("*");
      if (error) throw error;
      return (data ?? []) as UserPermission[];
    },
  });
}

export function useUpdatePermission() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
      override_reason,
    }: {
      id: string;
      updates: Partial<Pick<UserPermission, "can_view" | "can_create" | "can_edit" | "can_delete" | "can_export" | "can_approve" | "can_configure">>;
      override_reason?: string;
    }) => {
      const { error } = await supabase
        .from("permissions")
        .update({ ...updates, override_reason: override_reason || null } as any)
        .eq("id", id);
      if (error) throw error;

      // Log the permission change in access_logs
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("access_logs").insert({
          user_id: user.id,
          event_type: "permission_change",
          module_name: "usuarios_permissoes",
          device_info: JSON.stringify({ permission_id: id, changes: updates, override_reason }),
          success: true,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-permissions"] });
      qc.invalidateQueries({ queryKey: ["all-permissions"] });
    },
  });
}

// Helper to convert DB permissions to VECADX string
export function permissionsToVECAX(perm: UserPermission): string {
  let result = "";
  if (perm.can_view) result += "V";
  if (perm.can_edit) result += "E";
  if (perm.can_create) result += "C";
  if (perm.can_approve) result += "A";
  if (perm.can_delete) result += "D";
  if (perm.can_export) result += "X";
  return result || "—";
}
