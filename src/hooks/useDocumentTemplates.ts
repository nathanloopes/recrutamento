import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export function useDocumentTemplates(activeOnly = false) {
  return useQuery({
    queryKey: ["document_templates", activeOnly],
    queryFn: async () => {
      let q = supabase
        .from("document_templates" as any)
        .select("*")
        .order("name", { ascending: true });
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useCreateDocumentTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      category,
      file,
    }: {
      name: string;
      description: string;
      category: string;
      file?: File;
    }) => {
      let file_url: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() || "pdf";
        const path = `templates/${Date.now()}_${name.replace(/\s+/g, "_")}.${ext}`;
        const storage = await getStorageClient();
        const { error: upErr } = await storage.storage.from("documents").upload(path, file);
        if (upErr) throw upErr;
        file_url = path;
      }
      const { data, error } = await supabase
        .from("document_templates" as any)
        .insert({ name, description, category, file_url, created_by: user?.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document_templates"] });
      toast({ title: "Template criado!" });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao criar template", description: e.message, variant: "destructive" });
    },
  });
}

export function useToggleDocumentTemplate() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("document_templates" as any)
        .update({ is_active, updated_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document_templates"] });
      toast({ title: "Template atualizado" });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}
