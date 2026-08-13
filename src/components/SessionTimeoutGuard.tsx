import { useSessionTimeout } from "@/hooks/useSessionTimeout";

/**
 * Componente invisível que ativa o timeout de sessão por inatividade
 * conforme `security/session_timeout_minutes`. Deve ser montado dentro
 * do AuthProvider.
 */
export function SessionTimeoutGuard() {
  useSessionTimeout();
  return null;
}
