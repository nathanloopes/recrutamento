import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const centralOnlyRoutes = [
  "/admin/cargos",
  "/admin/pipelines",
  "/admin/unidades",
  "/admin/usuarios",
  "/admin/ia-avaliacoes",
  "/admin/plano-carreira",
  "/admin/notificacoes",
];

const adminOnlyRoutes = [
  "/admin/configuracoes",
  "/admin/integracoes",
  "/admin/migracoes",
];

const auditRoutes = ["/admin/logs"];

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, isAdmin, isAuditor, loading, authInitialized, profileLoaded, hasRole } = useAuth();
  const location = useLocation();

  if (!authInitialized || !profileLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin && !hasRole("auditor_admin")) return <Navigate to="/inicio" replace />;

  const path = location.pathname;
  const isCentral = hasRole("admin") || hasRole("rh_franqueadora");
  const isAdminOnly = hasRole("admin");

  if (adminOnlyRoutes.some(r => path.startsWith(r)) && !isAdminOnly) {
    return <Navigate to="/admin" replace />;
  }
  if (centralOnlyRoutes.some(r => path.startsWith(r)) && !isCentral && !hasRole("auditor_admin")) {
    return <Navigate to="/admin" replace />;
  }
  if (auditRoutes.some(r => path.startsWith(r)) && !isCentral && !hasRole("auditor_admin")) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
