import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface AIPromptVersion {
  id: string;
  name: string;
  description: string;
  prompt_text: string;
  target_scope: string;
  status: string;
  version: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export function usePromptVersions() {
  return useQuery({
    queryKey: ["ai-prompt-versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_prompt_versions")
        .select("*")
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AIPromptVersion[];
    },
  });
}

export function useCreatePromptVersion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      prompt_text,
      name,
      description,
      target_scope,
    }: {
      prompt_text: string;
      name: string;
      description: string;
      target_scope: string;
    }) => {
      const { data: existing } = await supabase
        .from("ai_prompt_versions")
        .select("version")
        .order("version", { ascending: false })
        .limit(1);

      const nextVersion = (existing?.[0]?.version ?? 0) + 1;
      const { data: userData } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("ai_prompt_versions")
        .insert({
          prompt_text,
          name,
          description,
          target_scope,
          status: "rascunho",
          version: nextVersion,
          is_active: false,
          created_by: userData.user?.id ?? null,
        } as any)
        .select()
        .single();

      if (error) throw error;

      // Notification: onPromptChange
      await supabase.from("notifications" as any).insert({
        event_type: "ai_prompt_created",
        recipient_id: userData.user?.id ?? null,
        channel: "push",
        title: "Novo prompt de IA criado",
        body: `Versão v${nextVersion} do prompt "${name || "sem nome"}" foi criada.`,
        status: "pending",
      } as any);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-prompt-versions"] });
      toast({ title: "Versão criada", description: "Nova versão do prompt criada com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });
}

export function useActivatePromptVersion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      // Deactivate all — set status to 'arquivado' for previously active
      const { error: archiveErr } = await supabase
        .from("ai_prompt_versions")
        .update({ is_active: false, status: "arquivado" } as any)
        .eq("is_active", true);

      if (archiveErr) throw archiveErr;

      // Set non-active non-target to rascunho (skip, they stay as-is)

      // Activate selected
      const { error: activateErr } = await supabase
        .from("ai_prompt_versions")
        .update({ is_active: true, status: "ativo" } as any)
        .eq("id", id);

      if (activateErr) throw activateErr;

      // Audit log
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("activity_logs").insert({
        user_id: userData.user?.id ?? null,
        action: "prompt_ativado",
        module: "ia_governanca",
        details: { prompt_id: id },
      } as any);

      // Notification: onNewVersionActivated
      await supabase.from("notifications" as any).insert({
        event_type: "ai_prompt_activated",
        recipient_id: userData.user?.id ?? null,
        channel: "push",
        title: "Prompt de IA ativado",
        body: `Uma nova versão do prompt institucional foi ativada.`,
        status: "pending",
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-prompt-versions"] });
      toast({ title: "Prompt ativado", description: "Versão do prompt ativada com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });
}
