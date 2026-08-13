import { useAuth } from "@/contexts/AuthContext";
import { SplashScreen } from "@/components/SplashScreen";

/**
 * AuthBootGate
 *
 * Gate global que bloqueia TODO o roteamento enquanto o boot de auth não
 * terminou. Enquanto `authInitialized` e `profileLoaded` não estiverem true,
 * nenhuma rota é montada — evitando flash da tela de Login no cold start do
 * PWA Android, onde o start_url reabre o app antes da sessão Supabase ser
 * restaurada do localStorage.
 *
 * Uso em App.tsx:
 *
 *   <AuthProvider>
 *     <AuthBootGate>
 *       <Routes>...</Routes>
 *     </AuthBootGate>
 *   </AuthProvider>
 */
export function AuthBootGate({ children }: { children: React.ReactNode }) {
  const { authInitialized, profileLoaded } = useAuth();

  if (!authInitialized || !profileLoaded) {
    return <SplashScreen />;
  }

  return <>{children}</>;
}
