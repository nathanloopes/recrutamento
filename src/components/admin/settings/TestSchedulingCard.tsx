import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TestPhasePanel } from "@/components/admin/scheduling/TestPhasePanel";

export function TestSchedulingCard() {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const scopedUnitIds = !isSuperAdmin && myUnitIds.length > 0 ? myUnitIds : undefined;
  const [selectedUnit, setSelectedUnit] = useState<string>("");

  const { data: units } = useQuery({
    queryKey: ["units_list", isSuperAdmin, myUnitIds],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").eq("is_active", true).order("name");
      if (!isSuperAdmin && myUnitIds.length > 0) {
        q = q.in("id", myUnitIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      if (data?.length === 1 && !selectedUnit) {
        setSelectedUnit(data[0].id);
      }
      return data;
    },
  });

  return (
    <TestPhasePanel
      selectedUnit={selectedUnit}
      setSelectedUnit={setSelectedUnit}
      units={units}
      scopedUnitIds={scopedUnitIds}
    />
  );
}
