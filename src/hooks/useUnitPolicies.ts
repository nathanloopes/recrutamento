import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface UnitPolicy {
  id: string;
  unit_id: string;
  radius_km: number;
  required_documents: string[];
  career_plan_enabled: boolean;
  allowed_roles: string[];
  language: string;
  tone: string;
  override_allowed: boolean;
  created_at: string;
  updated_at: string;
}

export function useUnitPolicy(unitId?: string) {
  return useQuery({
    queryKey: ["unit_policy", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_policies")
        .select("*")
        .eq("unit_id", unitId!)
        .maybeSingle();
      if (error) throw error;
      return data as UnitPolicy | null;
    },
  });
}

/** Fetches governance CrossConfig keys relevant to unit policy enforcement */
export function useUnitGovernanceConfig() {
  return useQuery({
    queryKey: ["unit_governance_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "units")
        .in("key", [
          "enforce_default_documents",
          "default_required_documents",
          "enforce_global_tone",
          "radius_min_limit",
          "career_plan_mandatory_for",
        ]);
      if (error) throw error;
      const map: Record<string, any> = {};
      (data || []).forEach((s) => { map[s.key] = s.value; });
      return {
        enforceDefaultDocuments: map.enforce_default_documents === true || map.enforce_default_documents === "true",
        defaultRequiredDocuments: Array.isArray(map.default_required_documents)
          ? (map.default_required_documents as any[]).map((d) => (typeof d === "string" ? d : d?.name ? String(d.name) : "")).filter(Boolean)
          : [],
        enforceGlobalTone: map.enforce_global_tone === true || map.enforce_global_tone === "true",
        radiusMinLimit: Number(map.radius_min_limit ?? 5),
        careerPlanMandatoryFor: Array.isArray(map.career_plan_mandatory_for) ? map.career_plan_mandatory_for as string[] : [],
      };
    },
  });
}

export function useUpdateUnitPolicy() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      unitId,
      updates,
    }: {
      unitId: string;
      updates: Partial<Omit<UnitPolicy, "id" | "unit_id" | "created_at" | "updated_at">>;
    }) => {
      // ── Governance enforcement: read CrossConfig ──
      const { data: govSettings } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "units")
        .in("key", [
          "enforce_default_documents",
          "default_required_documents",
          "enforce_global_tone",
          "radius_min_limit",
        ]);

      const gov: Record<string, any> = {};
      (govSettings || []).forEach((s) => { gov[s.key] = s.value; });

      // 1. enforce_default_documents: block removal of institutional docs
      if (updates.required_documents !== undefined) {
        const enforceDefaultDocs = gov.enforce_default_documents === true || gov.enforce_default_documents === "true";
        if (enforceDefaultDocs) {
          const institutionalDocs: string[] = Array.isArray(gov.default_required_documents)
            ? (gov.default_required_documents as any[]).map((d) => (typeof d === "string" ? d : d?.name ? String(d.name) : "")).filter(Boolean)
            : [];
          const updatedNames = (updates.required_documents as any[]).map((d) => (typeof d === "string" ? d : d?.name ? String(d.name) : ""));
          const missing = institutionalDocs.filter((d) => !updatedNames.includes(d));
          if (missing.length > 0) {
            throw new Error(`Documentos obrigatórios institucionais não podem ser removidos: ${missing.join(", ")}`);
          }
        }

        // Enforcement: protected_documents from CrossConfig
        const { data: protectedDocsSetting } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "units")
          .eq("key", "protected_documents")
          .maybeSingle();
        const protectedDocs: string[] = Array.isArray(protectedDocsSetting?.value)
          ? (protectedDocsSetting.value as any[]).map((d) => (typeof d === "string" ? d : d?.name ? String(d.name) : "")).filter(Boolean)
          : [];
        if (protectedDocs.length > 0) {
          const updatedNames2 = (updates.required_documents as any[]).map((d) => (typeof d === "string" ? d : d?.name ? String(d.name) : ""));
          const protectedMissing = protectedDocs.filter((d) => !updatedNames2.includes(d));
          if (protectedMissing.length > 0) {
            throw new Error(`Documentos protegidos não podem ser removidos: ${protectedMissing.join(", ")}`);
          }
        }
      }

      // 2. enforce_global_tone: block tone/language changes
      if (updates.tone !== undefined || updates.language !== undefined) {
        const enforceGlobalTone = gov.enforce_global_tone === true || gov.enforce_global_tone === "true";
        if (enforceGlobalTone) {
          throw new Error("Tom e idioma institucional estão protegidos. Alteração não permitida.");
        }
      }

      // 3. radius_min_limit: block radius below minimum
      if (updates.radius_km !== undefined) {
        const radiusMin = Number(gov.radius_min_limit ?? 5);
        if (updates.radius_km < radiusMin) {
          throw new Error(`Raio mínimo permitido: ${radiusMin} km`);
        }
      }

      const { data: prev } = await supabase
        .from("unit_policies")
        .select("*")
        .eq("unit_id", unitId)
        .single();

      const { error } = await supabase
        .from("unit_policies")
        .update(updates as any)
        .eq("unit_id", unitId);
      if (error) throw error;

      // Log the change
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("unit_config_logs").insert({
        unit_id: unitId,
        changed_by: userData.user?.id ?? null,
        change_type: "override",
        previous_config: prev ?? {},
        new_config: { ...prev, ...updates },
      } as any);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["unit_policy", vars.unitId] });
      toast({ title: "Configuração da unidade salva" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });
}

export function useProvisionUnit() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (unitId: string) => {
      const { error } = await supabase.rpc("provision_unit_defaults", {
        p_unit_id: unitId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unit_policy"] });
      toast({ title: "Unidade provisionada com sucesso" });
    },
    onError: (err: any) => {
      toast({ title: "Erro no provisionamento", description: err.message, variant: "destructive" });
    },
  });
}

/** Hook to fetch unit_config_logs for a specific unit */
export function useUnitConfigLogs(unitId?: string) {
  return useQuery({
    queryKey: ["unit_config_logs", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_config_logs")
        .select("*")
        .eq("unit_id", unitId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });
}
