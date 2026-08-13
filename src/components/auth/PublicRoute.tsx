import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isRecoveryMode, isRecoveryPending } from "@/lib/recoveryMode";
import { resolvePostAuthRedirect } from "@/lib/postAuthRedirect";

/**
 * PublicRoute
 *
 * Guarda rotas públicas (Landing, Login, Cadastro, Forgot/Reset Password).
 * Se uma sessão válida já existe, redireciona SÍNCRONAMENTE (durante render,
 * não em useEffect) para a área autenticada — isso elimina qualquer flash
 * visual da tela pública ao reabrir o PWA.
 *
 * EXCEÇÃO CRÍTICA — modo recuperação de senha:
 *  - Quando o usuário está em /reset-password (ou voltou dele para /auth
 *    após erro), a flag `auth.password_recovery_active` está setada e a
 *    sessão Supabase pode estar contaminada por um link de recuperação.
 *  - Nesse caso NÃO podemos redirecionar para /inicio nem /admin —
 *    isso geraria o bug "voltei ao login e entrei na conta sem senha".
 *  - A sessão é considerada temporária e o usuário precisa autenticar
 *    explicitamente com CPF/senha.
 *
 * Pré-requisito: deve estar sob <AuthBootGate>, que garante que authInitialized
 * e profileLoaded já são true quando este componente monta.
 */
export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, hasRole } = useAuth();
  const location = useLocation();

  // Em modo recuperação (sessionStorage por aba) OU enquanto houver um
  // ciclo de recuperação pendente (localStorage, sobrevive a reload),
  // JAMAIS redirecionar — mesmo com sessão presente. O usuário precisa
  // autenticar explicitamente com CPF+senha para sair desse estado.
  if (isRecoveryMode() || isRecoveryPending()) {
    return <>{children}</>;
  }

  // Rotas do fluxo de recuperação sempre renderizam, mesmo se houver
  // sessão antiga ainda no storage.
  if (
    location.pathname === "/reset-password" ||
    location.pathname === "/auth/recuperar-senha"
  ) {
    return <>{children}</>;
  }

  if (user) {
    if (isAdmin || hasRole("auditor_admin")) {
      return <Navigate to="/admin" replace />;
    }
    const pending = resolvePostAuthRedirect(location.search);
    return <Navigate to={pending ?? "/inicio"} replace />;
  }

  return <>{children}</>;
}
