import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TestPack {
  id: string;
  name: string;
  description: string;
  level: string;
  rules: { category: string; count: number }[];
  template_ids: string[];
  created_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useTestPacks(level?: string) {
  return useQuery({
    queryKey: ["test_packs", level],
    queryFn: async () => {
      let q = supabase
        .from("test_packs" as any)
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (level && level !== "todos") q = q.eq("level", level);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as TestPack[];
    },
  });
}

export function useCreateTestPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pack: Partial<TestPack>) => {
      const { data, error } = await supabase
        .from("test_packs" as any)
        .insert(pack as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_packs"] }),
  });
}

export function useUpdateTestPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TestPack> & { id: string }) => {
      const { data, error } = await supabase
        .from("test_packs" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_packs"] }),
  });
}

export function useDeleteTestPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("test_packs" as any)
        .update({ is_active: false } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_packs"] }),
  });
}
