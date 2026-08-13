import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DiscoveryAxis = "atividade" | "publico" | "ritmo" | "metas";

export interface DiscoveryTraitRow {
  id: string;
  label: string;
  axis: DiscoveryAxis;
  keywords: string[];
  sort_order: number;
  is_active: boolean;
  is_seed: boolean;
  legacy_id: string | null;
}

const QUERY_KEY = ["discovery_traits"];

export function useDiscoveryTraits(activeOnly = true) {
  return useQuery({
    queryKey: [...QUERY_KEY, activeOnly ? "active" : "all"],
    queryFn: async () => {
      let q = supabase.from("discovery_traits").select("*").order("sort_order", { ascending: true }).order("label", { ascending: true });
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DiscoveryTraitRow[];
    },
    staleTime: 60_000,
  });
}

export function useDiscoveryTraitsMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const addItem = useMutation({
    mutationFn: async (input: { label: string; axis?: DiscoveryAxis; keywords?: string[] }) => {
      const label = input.label.trim();
      if (!label) throw new Error("Informe um texto.");
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("discovery_traits")
        .insert({
          label,
          axis: input.axis ?? "atividade",
          keywords: input.keywords ?? [],
          sort_order: 999,
          is_seed: false,
          created_by: userRes.user?.id ?? null,
          updated_by: userRes.user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as DiscoveryTraitRow;
    },
    onSuccess: invalidate,
  });

  const toggleActive = useMutation({
    mutationFn: async (input: { id: string; is_active: boolean; reason?: string }) => {
      const { data: userRes } = await supabase.auth.getUser();
      const patch: Record<string, any> = { is_active: input.is_active, updated_by: userRes.user?.id ?? null };
      if (!input.is_active) {
        patch.deactivated_at = new Date().toISOString();
        patch.deactivated_by = userRes.user?.id ?? null;
        patch.deactivation_reason = input.reason ?? null;
      } else {
        patch.deactivated_at = null;
        patch.deactivated_by = null;
        patch.deactivation_reason = null;
      }
      const { data, error } = await supabase.from("discovery_traits").update(patch).eq("id", input.id).select().single();
      if (error) throw error;
      return data as DiscoveryTraitRow;
    },
    onSuccess: invalidate,
  });

  return { addItem, toggleActive };
}

/** Resolve label given an id that can be either uuid or legacy_id. */
export function makeTraitLabelMap(rows: DiscoveryTraitRow[] | undefined) {
  const map = new Map<string, string>();
  for (const r of rows ?? []) {
    map.set(r.id, r.label);
    if (r.legacy_id) map.set(r.legacy_id, r.label);
  }
  return map;
}
