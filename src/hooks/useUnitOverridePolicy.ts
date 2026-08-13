import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

/**
 * Returns true when:
 * - Global switch `allow_unit_override` is ON
 * - Unit is in the `unit_override_allowed_units` whitelist
 * - Current user is admin/RH (always true) OR a franqueado/gestor scoped to that unit
 */
export function useCanOverrideUnitJob(unitId: string | null | undefined) {
  const { data: settings } = useGlobalSettings("units");
  const { hasRole, unitIds } = useAuth();

  return useMemo(() => {
    if (!unitId || !settings) {
      return { canEdit: false, reason: "loading" as const };
    }
    // Sede (admin / RH) sempre pode personalizar — independe do switch/whitelist.
    // Gestor/franqueado é escopo de unidade e precisa da unidade autorizada.
    const isAdmin = hasRole("admin") || hasRole("rh_franqueadora");
    if (isAdmin) return { canEdit: true, reason: "admin" as const };

    const allowed = settings.find((s) => s.key === "allow_unit_override")?.value;
    const allowOverride = allowed === true || allowed === "true";
    if (!allowOverride) return { canEdit: false, reason: "switch_off" as const };

    const list = settings.find((s) => s.key === "unit_override_allowed_units")?.value;
    const whitelist: string[] = Array.isArray(list) ? list : [];
    const inWhitelist = whitelist.includes(unitId);
    if (!inWhitelist) return { canEdit: false, reason: "not_in_whitelist" as const };

    const isFranqueadoOfUnit = (hasRole("franqueado") || hasRole("gestor_recrutamento")) && unitIds.includes(unitId);
    if (isFranqueadoOfUnit) return { canEdit: true, reason: "franqueado" as const };

    return { canEdit: false, reason: "no_role" as const };
  }, [unitId, settings, hasRole, unitIds]);
}

export function useAllowedOverrideUnits() {
  const { data: settings } = useGlobalSettings("units");
  return useMemo(() => {
    const list = settings?.find((s) => s.key === "unit_override_allowed_units")?.value;
    return Array.isArray(list) ? (list as string[]) : [];
  }, [settings]);
}
