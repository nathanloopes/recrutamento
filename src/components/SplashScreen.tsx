/**
 * SplashScreen
 *
 * Tela leve exibida enquanto o boot de autenticação roda.
 * Substitui qualquer flash de rotas públicas (Login / Landing) no cold start
 * do PWA Android, onde o start_url reabre o app na raiz antes da sessão
 * Supabase ser restaurada do localStorage.
 */
export function SplashScreen() {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className="min-h-screen flex items-center justify-center bg-background app-safe-area"
    >
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
