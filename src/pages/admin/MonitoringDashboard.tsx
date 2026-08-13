import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { MonitoringDashboardSection } from "@/components/admin/MonitoringDashboardSection";
import { PlatformUsageSection } from "@/components/admin/PlatformUsageSection";
import { FranchiseePanelSection } from "@/components/admin/FranchiseePanelSection";

/**
 * Página dedicada do Dashboard de Monitoramento (acessível pelo perfil admin,
 * no mesmo padrão da Auditoria). Somente admin.
 */
export default function MonitoringDashboard() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasRole("admin")) navigate("/admin", { replace: true });
  }, [hasRole, navigate]);

  if (!hasRole("admin")) return null;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate("/admin/perfil")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao perfil
      </Button>
      <MonitoringDashboardSection />
      <div className="border-t border-border pt-6">
        <PlatformUsageSection />
      </div>
      <div className="border-t border-border pt-6">
        <FranchiseePanelSection />
      </div>
    </div>
  );
}
