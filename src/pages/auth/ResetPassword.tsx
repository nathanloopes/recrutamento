import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { KeyRound, CheckCircle, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  setRecoveryMode,
  clearRecoveryMode,
  setRecoveryPending,
  clearRecoveryPending,
} from "@/lib/recoveryMode";

function parseHashParams(): Record<string, string> {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.substring(1) : "";
  const params: Record<string, string> = {};
  if (!hash) return params;
  for (const part of hash.split("&")) {
    const [key, ...rest] = part.split("=");
    if (key) params[key] = decodeURIComponent(rest.join("="));
  }
  return params;
}

/**
 * Limpeza agressiva de qualquer sessão Supabase local.
 * - signOut local (revoga tokens em memória)
 * - remove explicitamente todas as chaves `sb-*-auth-token*` do localStorage e sessionStorage
 * - aguarda getSession() retornar null (até 500ms) para garantir propagação
 *
 * Crítico: enquanto este helper não confirmar sessão nula, NÃO podemos
 * navegar para rotas públicas — o PublicRoute poderia ver `user` ainda
 * hidratado e redirecionar para /inicio.
 */
async function hardPurgeSession() {
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* noop */ }

  // Remove qualquer chave de auth token persistida pelo SDK.
  const purgeKeys = (storage: Storage) => {
    try {
      const toDelete: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (!k) continue;
        if (k.startsWith("sb-") && k.includes("auth-token")) toDelete.push(k);
      }
      for (const k of toDelete) storage.removeItem(k);
    } catch { /* noop */ }
  };
  try { purgeKeys(localStorage); } catch { /* noop */ }
  try { purgeKeys(sessionStorage); } catch { /* noop */ }

  // Segundo signOut para descartar refs em memória após limpeza de storage.
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* noop */ }

  // Confirma sessão nula (poll curto, até 500ms).
  const start = Date.now();
  while (Date.now() - start < 500) {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
    } catch { return; }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Limpa parâmetros sensíveis (token_hash, code, hash de erro) da URL.
 */
function scrubUrl() {
  try {
    window.history.replaceState({}, "", "/reset-password");
  } catch {
    /* noop */
  }
}

export default function ResetPassword() {
  // Navegação ao sair do fluxo é feita via window.location.replace em
  // safeExitRecovery (hard nav, descarta estado React).
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [checking, setChecking] = useState(true);
  const bootstrapRanRef = useRef(false);

  useEffect(() => {
    if (bootstrapRanRef.current) return;
    bootstrapRanRef.current = true;

    let cancelled = false;

    // Marca AMBAS as flags imediatamente: aba ativa + ciclo persistente.
    // Enquanto recovery_pending estiver setado em localStorage, o app inteiro
    // (PublicRoute + AuthContext) bloqueia qualquer promoção de sessão antiga
    // a login real, mesmo após reload ou navegação dura.
    setRecoveryMode();
    setRecoveryPending();

    async function bootstrap() {
      // 1) Erros vindos do Supabase via hash (#error=...&error_code=otp_expired)
      const hashParams = parseHashParams();
      if (hashParams.error || hashParams.error_code) {
        const desc = (hashParams.error_description || "").replace(/\+/g, " ");
        await hardPurgeSession();
        scrubUrl();
        if (cancelled) return;
        if (hashParams.error_code === "otp_expired" || desc.toLowerCase().includes("expired")) {
          setLinkError("O link de recuperação expirou. Solicite um novo e-mail.");
        } else {
          setLinkError("Link inválido ou já utilizado. Solicite um novo e-mail de recuperação.");
        }
        setChecking(false);
        return;
      }

      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      const code = searchParams.get("code");

      // Antes de qualquer verifyOtp/exchange, descarta sessão antiga: o link
      // de recuperação só pode validar a si mesmo, nunca reusar sessão anterior.
      if (tokenHash || code) {
        await hardPurgeSession();
        if (cancelled) return;
      }

      // 2) Link customizado: ?token_hash=...&type=recovery
      if (tokenHash && (type === "recovery" || !type)) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (cancelled) return;
        if (verifyError) {
          await hardPurgeSession();
          scrubUrl();
          const msg = verifyError.message?.toLowerCase() || "";
          if (msg.includes("expired")) {
            setLinkError("O link de recuperação expirou. Solicite um novo e-mail.");
          } else if (msg.includes("invalid") || msg.includes("not found")) {
            setLinkError("Link inválido ou já utilizado. Solicite um novo e-mail de recuperação.");
          } else {
            setLinkError("Não foi possível validar o link. Solicite um novo e-mail.");
          }
          setChecking(false);
          return;
        }
        scrubUrl();
        setIsRecovery(true);
        setChecking(false);
        return;
      }

      // 3) Link via OAuth/PKCE: ?code=...
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          await hardPurgeSession();
          scrubUrl();
          const msg = exchangeError.message?.toLowerCase() || "";
          if (msg.includes("expired")) {
            setLinkError("O link de recuperação expirou. Solicite um novo e-mail.");
          } else {
            setLinkError("Link inválido ou já utilizado. Solicite um novo e-mail de recuperação.");
          }
          setChecking(false);
          return;
        }
        scrubUrl();
        setIsRecovery(true);
        setChecking(false);
        return;
      }

      // 4) Sem token e sem code: o link clássico do Supabase via /verify
      //    pode ter criado sessão e redirecionado pra cá. Só aceitamos como
      //    recuperação se o evento PASSWORD_RECOVERY chegar (listener abaixo).
      //    Caso contrário, NÃO consideramos recuperação válida — usuário
      //    precisa solicitar novo link. Isso evita usar uma sessão antiga
      //    do mesmo navegador como autorização para trocar senha.
      //
      //    Damos uma janela curta para o evento chegar; se não chegar,
      //    tratamos como link inválido.
      setChecking(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
        setLinkError("");
        setChecking(false);
      }
    });

    void bootstrap();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [searchParams]);

  const valid = password.length >= 6 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (!isRecovery) {
      setError("Sessão de recuperação não encontrada. Solicite um novo e-mail.");
      return;
    }
    setLoading(true);
    setError("");

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("Erro ao redefinir senha. Tente novamente.");
      setLoading(false);
      return;
    }

    // Encerra a sessão temporária de recuperação. As flags continuam ativas
    // até o usuário clicar no botão de saída (que faz hard nav). Isso garante
    // que, mesmo se algum evento de auth chegar atrasado, o app não promova
    // sessão a login real.
    await hardPurgeSession();
    setSuccess(true);
    setLoading(false);
  };

  /**
   * Saída atômica do fluxo de recuperação:
   *  1) hardPurge garante sessão Supabase nula (storage + memória).
   *  2) Limpa AMBAS as flags de recuperação.
   *  3) Hard navigation (window.location.replace) descarta todo o estado
   *     React em memória — eliminando qualquer chance de o PublicRoute
   *     ver `user` hidratado e redirecionar para área autenticada.
   */
  const safeExitRecovery = async (target: string) => {
    await hardPurgeSession();
    clearRecoveryMode();
    clearRecoveryPending();
    window.location.replace(target);
  };

  const handleRequestNewLink = () => { void safeExitRecovery("/auth/recuperar-senha"); };
  const handleBackToLogin = () => { void safeExitRecovery("/auth"); };

  // Link expired / invalid error state
  if (linkError) {
    return (
      <div className="grid min-h-screen md:grid-cols-2 app-safe-area">
        <div className="relative hidden md:block">
          <img src={heroTeam} alt="Equipe" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#3D2B1F]/70" />
        </div>
        <div className="flex flex-col items-center justify-center px-6 py-12 bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50">
          <div className="w-full max-w-sm animate-slide-up text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="text-lg font-bold text-[#3D2B1F] mb-2">Link indisponível</h2>
            <p className="text-sm text-[#3D2B1F]/60 mb-6">{linkError}</p>
            <div className="space-y-3">
              <Button
                onClick={handleRequestNewLink}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              >
                Solicitar novo link
              </Button>
              <Button
                variant="outline"
                onClick={handleBackToLogin}
                className="w-full"
              >
                Voltar ao login
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="grid min-h-screen md:grid-cols-2 app-safe-area">
        <div className="relative hidden md:block">
          <img src={heroTeam} alt="Equipe" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#3D2B1F]/70" />
        </div>
        <div className="flex flex-col items-center justify-center px-6 py-12 bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50">
          <div className="w-full max-w-sm animate-slide-up text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 mb-4">
              <CheckCircle className="h-8 w-8 text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-[#3D2B1F] mb-2">Senha redefinida!</h2>
            <p className="text-sm text-[#3D2B1F]/60 mb-6">
              Sua senha foi atualizada com sucesso. Faça login com a nova senha.
            </p>
            <Button
              onClick={handleBackToLogin}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            >
              Ir para o login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50 app-safe-area">
        <p className="text-[#3D2B1F]/60 animate-pulse">Verificando link de recuperação...</p>
      </div>
    );
  }

  // Sem token, sem code, sem evento PASSWORD_RECOVERY: usuário caiu na página
  // sem link válido. Mostra estado de erro consistente em vez de exibir o
  // formulário de nova senha (que não funcionaria).
  if (!isRecovery) {
    return (
      <div className="grid min-h-screen md:grid-cols-2 app-safe-area">
        <div className="relative hidden md:block">
          <img src={heroTeam} alt="Equipe" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#3D2B1F]/70" />
        </div>
        <div className="flex flex-col items-center justify-center px-6 py-12 bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50">
          <div className="w-full max-w-sm animate-slide-up text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 mb-4">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-[#3D2B1F] mb-2">Link de recuperação necessário</h2>
            <p className="text-sm text-[#3D2B1F]/60 mb-6">
              Para redefinir sua senha, abra esta página pelo link enviado no seu e-mail.
            </p>
            <div className="space-y-3">
              <Button
                onClick={handleRequestNewLink}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              >
                Solicitar link de recuperação
              </Button>
              <Button
                variant="outline"
                onClick={handleBackToLogin}
                className="w-full"
              >
                Voltar ao login
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh md:grid-cols-2 app-safe-area">
      <div className="relative hidden md:block">
        <img src={heroTeam} alt="Equipe" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[#3D2B1F]/70" />
        <div className="relative z-10 flex h-full flex-col justify-end p-12">
          <h2 className="text-3xl font-bold text-white leading-tight">Redefinir senha</h2>
          <p className="mt-4 text-white/80 text-lg">Digite sua nova senha abaixo.</p>
        </div>
      </div>

      <div className="flex flex-col items-center justify-start md:justify-center px-6 pt-12 pb-[60vh] md:pb-12 bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="text-center mb-6">
            <img src={logoHeader} alt="Recruta" className="h-14 mx-auto mb-4" />
          </div>

          <Card className="border-0 shadow-2xl">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100">
                  <KeyRound className="h-5 w-5 text-amber-600" />
                </div>
                <CardTitle className="text-lg font-bold text-[#3D2B1F]">Nova senha</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[#3D2B1F]">Nova senha</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Mínimo 6 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pr-10 focus-visible:ring-amber-500"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3D2B1F]/60 hover:text-[#3D2B1F]"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[#3D2B1F]">Confirmar nova senha</Label>
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Repita a senha"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="h-11 focus-visible:ring-amber-500"
                    autoComplete="new-password"
                  />
                  {confirm.length > 0 && password !== confirm && (
                    <p className="text-xs text-destructive">As senhas não coincidem.</p>
                  )}
                </div>

                {error && (
                  <p className="text-xs text-destructive animate-fade-in">{error}</p>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 text-base font-semibold bg-amber-500 hover:bg-amber-600 text-white"
                  disabled={loading || !valid}
                >
                  {loading ? "Salvando..." : "Redefinir senha"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
