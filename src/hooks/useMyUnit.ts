import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useMyUnit() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my_unit", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // Get all unit_ids from user_roles for scoped roles
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("unit_id")
        .eq("user_id", user!.id)
        .in("role", ["franqueado", "gestor_recrutamento", "rh_franqueadora"] as any)
        .not("unit_id", "is", null);

      if (roleErr) throw roleErr;
      if (!roleData?.length) return null;

      const unitIds = roleData.map((r: any) => r.unit_id);

      // Fetch unit details
      const { data: units, error: unitErr } = await supabase
        .from("units")
        .select("id, name, code, city, state")
        .in("id", unitIds);

      if (unitErr) throw unitErr;
      return units && units.length > 0 ? units : null;
    },
  });
}

/** Returns the first unit (backwards compat) */
export function useMyFirstUnit() {
  const { data } = useMyUnit();
  return Array.isArray(data) ? data[0] : data;
}
