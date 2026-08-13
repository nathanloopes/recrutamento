import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ScheduleGroup = {
  id: string;
  name: string | null;
  created_at: string;
  updated_at: string;
};

export type UnitLite = { id: string; name: string; schedule_group_id: string | null };

/** Lista todos os grupos e a quais unidades cada grupo está vinculado. */
export function useScheduleGroupsWithUnits() {
  return useQuery({
    queryKey: ["schedule_groups_with_units"],
    queryFn: async () => {
      const [groupsRes, unitsRes] = await Promise.all([
        (supabase as any).from("schedule_groups").select("*").order("created_at"),
        supabase.from("units").select("id, name, schedule_group_id" as any).eq("is_active", true).order("name"),
      ]);
      if (groupsRes.error) throw groupsRes.error;
      if (unitsRes.error) throw unitsRes.error;
      const groups = (groupsRes.data || []) as ScheduleGroup[];
      const units = (unitsRes.data || []) as unknown as UnitLite[];
      return groups.map((g) => ({
        ...g,
        units: units.filter((u) => u.schedule_group_id === g.id),
      }));
    },
  });
}

/** Cria um grupo com as unidades selecionadas (mínimo 2). */
export function useCreateScheduleGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, unitIds }: { name?: string | null; unitIds: string[] }) => {
      if (unitIds.length < 2) throw new Error("Selecione pelo menos 2 unidades");
      const { data: group, error } = await (supabase as any)
        .from("schedule_groups")
        .insert({ name: name || null })
        .select("*")
        .single();
      if (error) throw error;
      const { data: affected, error: rpcErr } = await (supabase as any).rpc("set_schedule_group_units", {
        _group_id: group.id,
        _unit_ids: unitIds,
      });
      if (rpcErr) {
        await (supabase as any).from("schedule_groups").delete().eq("id", group.id);
        throw rpcErr;
      }
      if (!affected || Number(affected) === 0) {
        await (supabase as any).from("schedule_groups").delete().eq("id", group.id);
        throw new Error("Nenhuma unidade foi vinculada ao grupo. Verifique suas permissões.");
      }
      return group as ScheduleGroup;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule_groups_with_units"] });
      qc.invalidateQueries({ queryKey: ["units"] });
      qc.invalidateQueries({ queryKey: ["available_times"] });
      qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
    },
  });
}

/** Atualiza as unidades de um grupo (set difference). */
export function useUpdateScheduleGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      groupId,
      name,
      unitIds,
    }: {
      groupId: string;
      name?: string | null;
      unitIds: string[];
    }) => {
      if (unitIds.length < 2) throw new Error("Selecione pelo menos 2 unidades");
      if (name !== undefined) {
        const { error } = await (supabase as any)
          .from("schedule_groups")
          .update({ name: name || null })
          .eq("id", groupId);
        if (error) throw error;
      }
      const { error: rpcErr } = await (supabase as any).rpc("set_schedule_group_units", {
        _group_id: groupId,
        _unit_ids: unitIds,
      });
      if (rpcErr) throw rpcErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule_groups_with_units"] });
      qc.invalidateQueries({ queryKey: ["units"] });
      qc.invalidateQueries({ queryKey: ["available_times"] });
      qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
    },
  });
}


/** Desfaz o grupo: desvincula todas as unidades e remove o grupo. */
export function useDeleteScheduleGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      await (supabase as any).from("units").update({ schedule_group_id: null }).eq("schedule_group_id", groupId);
      const { error } = await (supabase as any).from("schedule_groups").delete().eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule_groups_with_units"] });
      qc.invalidateQueries({ queryKey: ["units"] });
      qc.invalidateQueries({ queryKey: ["available_times"] });
      qc.invalidateQueries({ queryKey: ["unavailable_dates"] });
    },
  });
}

/**
 * Busca os unit_ids que compartilham agenda com a unidade informada.
 * Sempre retorna ao menos a própria unidade.
 */
export async function fetchScheduleGroupUnitIds(unitId: string): Promise<string[]> {
  if (!unitId) return [];
  const { data, error } = await (supabase as any).rpc("get_unit_schedule_group_ids", { _unit_id: unitId });
  if (error || !data) return [unitId];
  const arr = Array.isArray(data) ? (data as string[]) : [unitId];
  return arr.length > 0 ? arr : [unitId];
}
