import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DefaultJobAttributeKind = "benefit" | "responsibility" | "requirement";

export interface DefaultJobAttribute {
  id: string;
  kind: DefaultJobAttributeKind;
  label: string;
  is_active: boolean;
  is_seed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
}

const QUERY_KEY = ["default_job_attributes"];

/** Itens ATIVOS de um tipo — usado nos formulários de vaga (sugestões). */
export function useDefaultJobAttributes(kind: DefaultJobAttributeKind) {
  return useQuery({
    queryKey: [...QUERY_KEY, kind, "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("default_job_attributes")
        .select("*")
        .eq("kind", kind)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DefaultJobAttribute[];
    },
    staleTime: 60_000,
  });
}

/** Todos os itens (incluindo ocultos) — usado na tela admin de gestão. */
export function useAllDefaultJobAttributes(kind: DefaultJobAttributeKind) {
  return useQuery({
    queryKey: [...QUERY_KEY, kind, "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("default_job_attributes")
        .select("*")
        .eq("kind", kind)
        .order("is_active", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DefaultJobAttribute[];
    },
    staleTime: 30_000,
  });
}

export function useDefaultJobAttributesMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const addItem = useMutation({
    mutationFn: async (input: { kind: DefaultJobAttributeKind; label: string; sort_order?: number }) => {
      const label = input.label.trim();
      if (!label) throw new Error("Informe um texto.");
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("default_job_attributes")
        .insert({
          kind: input.kind,
          label,
          sort_order: input.sort_order ?? 999,
          is_seed: false,
          created_by: userRes.user?.id ?? null,
          updated_by: userRes.user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as DefaultJobAttribute;
    },
    onSuccess: invalidate,
  });

  const editLabel = useMutation({
    mutationFn: async (input: { id: string; label: string }) => {
      const label = input.label.trim();
      if (!label) throw new Error("Informe um texto.");
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("default_job_attributes")
        .update({ label, updated_by: userRes.user?.id ?? null })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as DefaultJobAttribute;
    },
    onSuccess: invalidate,
  });

  /** Soft-delete (oculta) ou restaura. */
  const toggleActive = useMutation({
    mutationFn: async (input: { id: string; is_active: boolean; reason?: string }) => {
      const { data: userRes } = await supabase.auth.getUser();
      const patch: Record<string, any> = {
        is_active: input.is_active,
        updated_by: userRes.user?.id ?? null,
      };
      if (!input.is_active) {
        patch.deactivated_at = new Date().toISOString();
        patch.deactivated_by = userRes.user?.id ?? null;
        patch.deactivation_reason = input.reason ?? null;
      } else {
        patch.deactivated_at = null;
        patch.deactivated_by = null;
        patch.deactivation_reason = null;
      }
      const { data, error } = await supabase
        .from("default_job_attributes")
        .update(patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as DefaultJobAttribute;
    },
    onSuccess: invalidate,
  });

  /** Hard-delete — apenas itens NÃO-seed. RLS bloqueia seeds. */
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("default_job_attributes").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: invalidate,
  });

  return { addItem, editLabel, toggleActive, deleteItem };
}
