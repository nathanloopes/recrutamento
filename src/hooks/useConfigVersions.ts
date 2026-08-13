import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ConfigVersion {
  id: string;
  version_number: number;
  config_snapshot: any;
  environment: string;
  created_by: string | null;
  description: string | null;
  created_at: string;
}

export interface RollbackEvent {
  id: string;
  restored_version_id: string;
  triggered_by: string | null;
  justification: string;
  created_at: string;
}

export function useConfigVersions() {
  return useQuery({
    queryKey: ["config_versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("config_versions")
        .select("*")
        .order("version_number", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as ConfigVersion[];
    },
  });
}

export function useCreateConfigVersion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (description?: string) => {
      // Capture full snapshot of global_settings
      const { data: settings, error: settingsError } = await supabase
        .from("global_settings")
        .select("category, key, value");
      if (settingsError) throw settingsError;

      const snapshot: Record<string, any> = {};
      for (const s of settings || []) {
        if (!snapshot[s.category]) snapshot[s.category] = {};
        snapshot[s.category][s.key] = s.value;
      }

      const { data: userData } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("config_versions")
        .insert({
          config_snapshot: snapshot,
          created_by: userData.user?.id,
          description: description || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config_versions"] });
      toast({ title: "Versão criada", description: "Snapshot do CrossConfig salvo com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao criar versão", description: error.message, variant: "destructive" });
    },
  });
}

export function useRollbackToVersion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      versionId,
      justification,
    }: {
      versionId: string;
      justification: string;
    }) => {
      // 1. Fetch the version snapshot
      const { data: version, error: versionError } = await supabase
        .from("config_versions")
        .select("*")
        .eq("id", versionId)
        .single();
      if (versionError) throw versionError;

      const snapshot = version.config_snapshot as Record<string, Record<string, any>>;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      // 2. Apply each setting from the snapshot
      for (const category of Object.keys(snapshot)) {
        for (const key of Object.keys(snapshot[category])) {
          await supabase
            .from("global_settings")
            .update({
              value: snapshot[category][key],
              updated_by: userId,
              updated_at: new Date().toISOString(),
            })
            .eq("category", category)
            .eq("key", key);
        }
      }

      // 3. Create a new version (post-rollback snapshot)
      const { data: currentSettings } = await supabase
        .from("global_settings")
        .select("category, key, value");

      const newSnapshot: Record<string, any> = {};
      for (const s of currentSettings || []) {
        if (!newSnapshot[s.category]) newSnapshot[s.category] = {};
        newSnapshot[s.category][s.key] = s.value;
      }

      await supabase.from("config_versions").insert({
        config_snapshot: newSnapshot,
        created_by: userId,
        description: `Rollback para versão #${version.version_number}`,
      });

      // 4. Record rollback event
      const { error: rollbackError } = await supabase
        .from("rollback_events")
        .insert({
          restored_version_id: versionId,
          triggered_by: userId,
          justification,
        });
      if (rollbackError) throw rollbackError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config_versions"] });
      queryClient.invalidateQueries({ queryKey: ["rollback_events"] });
      queryClient.invalidateQueries({ queryKey: ["global_settings"] });
      toast({ title: "Rollback realizado", description: "Configurações restauradas com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro no rollback", description: error.message, variant: "destructive" });
    },
  });
}

export function useRollbackEvents() {
  return useQuery({
    queryKey: ["rollback_events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rollback_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as RollbackEvent[];
    },
  });
}
