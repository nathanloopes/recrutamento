import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getWelcomeSeenKey } from "@/pages/candidate/Welcome";

export function CandidateRoute({ children }: { children?: React.ReactNode }) {
  const { user, isAdmin, loading, authInitialized, profileLoaded, hasRole } = useAuth();
  const location = useLocation();

  // Detecta se o candidato já é "retornante" (tem histórico no banco).
  // Isso evita reexibir o onboarding "Oi 😊" em apps nativos quando o
  // localStorage é limpo (reinstalação, limpeza de dados, storage do WebView, etc.).
  const { data: isReturning, isLoading: checkingReturning } = useQuery({
    queryKey: ["candidate_is_returning", user?.id],
    enabled: !!user && !isAdmin && !hasRole("auditor_admin"),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", user!.id);
      if (error) throw error;
      return (count || 0) > 0;
    },
  });

  // Persiste a flag localmente para futuras cargas (evita nova query)
  useEffect(() => {
    if (!user?.id || !isReturning) return;
    try {
      localStorage.setItem(getWelcomeSeenKey(user.id), "true");
    } catch {
      /* ignore */
    }
  }, [user?.id, isReturning]);

  if (!authInitialized || !profileLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;

  // Redirect admins to admin panel
  if (isAdmin || hasRole("auditor_admin")) return <Navigate to="/admin" replace />;

  // Onboarding de primeiro acesso: tela "Oi 😊" antes de qualquer outra rota.
  let welcomeSeen = false;
  try {
    welcomeSeen = localStorage.getItem(getWelcomeSeenKey(user.id)) === "true";
  } catch {
    welcomeSeen = true; // se storage falhar, não bloqueia o usuário
  }

  // Aguarda a checagem server-side antes de decidir redirecionar, para não
  // "piscar" a tela de boas-vindas para candidatos retornantes.
  if (!welcomeSeen && checkingReturning) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const effectivelySeen = welcomeSeen || isReturning === true;

  if (!effectivelySeen && location.pathname !== "/bem-vindo") {
    return <Navigate to="/bem-vindo" replace />;
  }

  return <>{children || <Outlet />}</>;
}
