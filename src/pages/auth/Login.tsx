import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Loader2, CheckCircle2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCPF, cleanCPF, isValidCPF } from "@/lib/cpf";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/client";
import { TurnstileWidget, isCaptchaEnabled, type TurnstileHandle } from "@/components/auth/TurnstileWidget";
import { useToast } from "@/hooks/use-toast";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
// logFailedLogin: agora tratado server-side pela edge function `sign-in-with-cpf`.
import { clearAllRecoveryFlags } from "@/lib/recoveryMode";
import { resolvePostAuthRedirect } from "@/lib/postAuthRedirect";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast as sonnerToast } from "sonner";

type Phase = "cpf" | "identified" | "loading_cpf";
const DEACTIVATED_PROMPT_KEY = "auth.deactivated_account_prompt";
const DEACTIVATED_LOGIN_PENDING_KEY = "auth.deactivated_login_pending";
const DEACTIVATED_SUPPRESS_TOAST_KEY = "suppress_deactivated_toast";

const loginFlowLog = (_step: string, _details?: Record<string, unknown>) => {
  /* logs silenciados */
};

type DeactivatedPrompt = { cpf?: string; at?: number };

function readDeactivatedPrompt(): DeactivatedPrompt | null {
  try {
    const raw = window.sessionStorage?.getItem(DEACTIVATED_PROMPT_KEY);
    return raw ? JSON.parse(raw) as DeactivatedPrompt : null;
  } catch {
    return null;
  }
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const locationState = location.state as { cpf?: string; email?: string; deactivated?: boolean } | null;

  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("cpf");
  const [loginLoading, setLoginLoading] = useState(false);
  const [initializedFromState, setInitializedFromState] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [deactivatedDialog, setDeactivatedDialog] = useState<{ open: boolean; cpf: string }>({ open: false, cpf: "" });

  const passwordRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // CrossConfig: allow_registration_without_vacancy
  const { data: cadastroSettings } = useGlobalSettings("cadastro");
  const allowRegWithoutVacancy = cadastroSettings?.find(s => s.key === "allow_registration_without_vacancy")?.value ?? true;

  // Nota: redirect de usuário autenticado é feito SÍNCRONAMENTE pelo PublicRoute
  // (ver src/components/auth/PublicRoute.tsx). Se este componente montou, o
  // usuário está garantidamente deslogado — sem checks de auth aqui para
  // evitar qualquer flash visual da tela de login no cold start do PWA.

  // ============================================================================
  // Credential Management API — store pós-login
  // ============================================================================
  // Regras:
  //  - Após login bem-sucedido, oferecemos à API salvar a credencial (id=CPF).
  //  - Autofill é feito pelo comportamento NATIVO do browser no focus do campo
  //    de senha (autocomplete="current-password"). Não chamamos credentials.get()
  //    programaticamente: no Android Chrome com múltiplas credenciais, isso
  //    dispara biometria duas vezes (uma vazia via API + outra via UI nativa
  //    ao selecionar no picker), degradando a UX. A UI nativa do Chrome já
  //    trata biometria + picker + autofill de forma correta.
  //  - Nada é gravado em localStorage.
  //  - Logout NÃO remove credenciais (respeito ao cofre do dispositivo).

  const storeCredentials = useCallback(async (cpfId: string, pwd: string) => {
    try {
      const W = window as unknown as {
        PasswordCredential?: new (init: { id: string; password: string; name?: string }) => unknown;
      };
      if (typeof W.PasswordCredential === "undefined") return;
      const cred = new W.PasswordCredential({ id: cpfId, password: pwd, name: cpfId });
      await (navigator as unknown as { credentials?: { store?: (c: unknown) => Promise<unknown> } })
        .credentials?.store?.(cred);
    } catch (err) {
      // Falha silenciosa — fallback implícito é o password manager do browser.
      console.debug("[Login] credentials.store indisponível:", err);
    }
  }, []);

  // Após autenticar com sucesso, verifica se a conta está desativada antes de redirecionar.
  // Retorna true quando a conta está desativada (e já abriu o dialog), false caso contrário.
  const checkDeactivatedAfterLogin = useCallback(async (cleanedCpf: string): Promise<boolean> => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        const queuedPrompt = readDeactivatedPrompt();
        if (queuedPrompt?.cpf) {
          setPassword("");
          setPhase("cpf");
          setLoginLoading(false);
          setDeactivatedDialog({ open: true, cpf: queuedPrompt.cpf });
          try { window.sessionStorage?.removeItem(DEACTIVATED_PROMPT_KEY); } catch { /* ignore */ }
          try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
          try { window.sessionStorage?.removeItem(DEACTIVATED_SUPPRESS_TOAST_KEY); } catch { /* ignore */ }
          return true;
        }
        return false;
      }
      const { data: cand } = await supabase
        .from("candidates")
        .select("is_active, cpf")
        .eq("id", uid)
        .maybeSingle();
      if (cand && (cand as any).is_active === false) {
        const promptCpf = (cand as any).cpf || cleanedCpf;
        try {
          window.sessionStorage?.setItem(DEACTIVATED_SUPPRESS_TOAST_KEY, "1");
          window.sessionStorage?.setItem(DEACTIVATED_PROMPT_KEY, JSON.stringify({ cpf: promptCpf, at: Date.now() }));
        } catch { /* ignore */ }
        try { await supabase.auth.signOut(); } catch { /* ignore */ }
        setPassword("");
        setPhase("cpf");
        setLoginLoading(false);
        setDeactivatedDialog({ open: true, cpf: promptCpf });
        try { window.sessionStorage?.removeItem(DEACTIVATED_PROMPT_KEY); } catch { /* ignore */ }
        try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
        try { window.sessionStorage?.removeItem(DEACTIVATED_SUPPRESS_TOAST_KEY); } catch { /* ignore */ }
        return true;
      }
    } catch (e) {
      console.warn("[Login] checkDeactivatedAfterLogin falhou:", e);
      const queuedPrompt = readDeactivatedPrompt();
      if (queuedPrompt?.cpf) {
        setPassword("");
        setPhase("cpf");
        setLoginLoading(false);
        setDeactivatedDialog({ open: true, cpf: queuedPrompt.cpf });
        try { window.sessionStorage?.removeItem(DEACTIVATED_PROMPT_KEY); } catch { /* ignore */ }
        try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
        try { window.sessionStorage?.removeItem(DEACTIVATED_SUPPRESS_TOAST_KEY); } catch { /* ignore */ }
        return true;
      }
    }
    try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
    return false;
  }, []);

  // Hydrate from navigation state (coming from LandingPage)

  const lookupCpf = useCallback(async (cleaned: string) => {
    setPhase("loading_cpf");
    setError("");

    const TIMEOUT_MS = 10_000;

    try {
      const rpcPromise = supabase.rpc("check_cpf_status_rl", { _cpf: cleaned });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("lookup_cpf_timeout")), TIMEOUT_MS)
      );

      const raceResult = await Promise.race([rpcPromise, timeoutPromise]) as
        | { data: unknown; error: { message: string } | null }
        | never;

      const { data, error: rpcError } = raceResult;

      if (rpcError) {
        console.error("[Login][lookupCpf] rpc error:", rpcError.message);
        setError("Erro ao consultar. Tente novamente.");
        setPhase("cpf");
        return;
      }

      // RPC devolve { exists, is_active, rate_limited? } — o e-mail é resolvido
      // server-side pela edge function `sign-in-with-cpf` no momento do login.
      const result = data as unknown as { exists?: boolean; is_active?: boolean; rate_limited?: boolean };

      // Rate-limit da consulta de CPF NÃO significa "não cadastrado". Quando
      // bloqueado, a RPC retorna exists=false + rate_limited=true; não devemos
      // redirecionar para o cadastro — orientamos a aguardar e tentar de novo.
      if (result?.rate_limited) {
        setError("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
        setPhase("cpf");
        return;
      }

      if (result?.exists) {
        if (result.is_active === false) {
          setDeactivatedDialog({ open: true, cpf: cleaned });
          setPhase("cpf");
          return;
        }
        setPhase("identified");
        setTimeout(() => passwordRef.current?.focus(), 100);
      } else {
        // CPF not found → check CrossConfig before allowing registration
        if (!allowRegWithoutVacancy) {
          setError("Não há vagas abertas no momento. Tente novamente mais tarde.");
          setPhase("cpf");
        } else {
          navigate(`/auth/cadastro${location.search ?? ""}`, { state: { cpf: cleaned } });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Login][lookupCpf] catch:", msg);
      if (msg === "lookup_cpf_timeout") {
        setError("Tempo esgotado. Verifique sua conexão e tente novamente.");
      } else {
        setError("Erro de conexão. Tente novamente.");
      }
      setPhase("cpf");
    }
  }, [navigate, allowRegWithoutVacancy, location.search]);

  // Hydrate from navigation state (coming from LandingPage)
  useEffect(() => {
    if (initializedFromState || !locationState?.cpf) return;
    setInitializedFromState(true);

    const cleaned = locationState.cpf;
    setCpf(formatCPF(cleaned));

    if (locationState.deactivated) {
      setPassword("");
      setEmail("");
      setPhase("cpf");
      setDeactivatedDialog({ open: true, cpf: cleaned });
      return;
    }

    if (cleaned.length === 11 && isValidCPF(cleaned)) {
      lookupCpf(cleaned);
    }
  }, [locationState, initializedFromState, lookupCpf]);

  useEffect(() => {
    const queuedPrompt = readDeactivatedPrompt();
    if (!queuedPrompt?.cpf) return;

    const cleaned = cleanCPF(queuedPrompt.cpf);
    setCpf(formatCPF(cleaned));
    setEmail("");
    setPassword("");
    setPhase("cpf");
    setLoginLoading(false);
    setDeactivatedDialog({ open: true, cpf: cleaned });
    try { window.sessionStorage?.removeItem(DEACTIVATED_PROMPT_KEY); } catch { /* ignore */ }
    try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
    try { window.sessionStorage?.removeItem(DEACTIVATED_SUPPRESS_TOAST_KEY); } catch { /* ignore */ }
  }, []);

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCPF(e.target.value);
    setCpf(formatted);
    if (error) setError("");

    // Reset state when CPF changes
    if (phase !== "cpf" && phase !== "loading_cpf") {
      setEmail("");
      setPassword("");
      setPhase("cpf");
    }

    // Debounced auto-lookup
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const cleaned = cleanCPF(formatted);
    if (cleaned.length === 11 && isValidCPF(cleaned)) {
      debounceRef.current = setTimeout(() => lookupCpf(cleaned), 500);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (phase !== "identified") return;

    if (password.length < 6) {
      setError("Senha deve ter no mínimo 6 caracteres");
      return;
    }

    setLoginLoading(true);
    setError("");

    const cleaned = cleanCPF(cpf);
    loginFlowLog("submit", {
      path: location.pathname,
      search: location.search,
      phase,
      cpfLength: cleaned.length,
    });
    try {
      window.sessionStorage?.setItem(DEACTIVATED_LOGIN_PENDING_KEY, cleaned);
    } catch { /* ignore */ }

    // CAPTCHA (quando habilitado): exige verificação anti-bot antes do login.
    if (isCaptchaEnabled() && !captchaToken) {
      setError("Confirme que você não é um robô para continuar.");
      setLoginLoading(false);
      return;
    }

    try {
      // Login unificado por CPF. A edge function resolve o e-mail server-side
      // (nunca chega ao cliente), tenta delegação ERP e cai em Supabase
      // Auth se preciso. Assim o e-mail não trafega pelo browser.
      loginFlowLog("sign-in-with-cpf:start");
      const response = await fetch(`${SUPABASE_URL}/functions/v1/sign-in-with-cpf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ cpf: cleaned, password, captchaToken: captchaToken || undefined }),
      });

      const payload = await response.json().catch(() => null) as
        | { session?: { access_token: string; refresh_token: string }; path?: string;
            error?: string; attempts?: number; max_attempts?: number }
        | null;

      if (isCaptchaEnabled()) { turnstileRef.current?.reset(); setCaptchaToken(""); }

      loginFlowLog("sign-in-with-cpf:response", {
        ok: response.ok, status: response.status, path: payload?.path ?? null,
        error: payload?.error ?? null,
      });

      if (!response.ok || !payload?.session) {
        const err = payload?.error;
        if (response.status === 429 || err === "rate_limited") {
          setError("Muitas tentativas. Tente novamente em instantes.");
        } else if (err === "account_deactivated") {
          setDeactivatedDialog({ open: true, cpf: cleaned });
        } else if (err === "locked") {
          const a = payload?.attempts ?? 0;
          const m = payload?.max_attempts ?? 5;
          setError(`Conta temporariamente bloqueada. Muitas tentativas falhas (${a}/${m}). Tente novamente em 30 minutos.`);
        } else if (err === "invalid_credentials") {
          const a = payload?.attempts ?? 0;
          const m = payload?.max_attempts ?? 5;
          setError(a > 0 ? `CPF ou senha incorretos (tentativa ${a}/${m})` : "CPF ou senha incorretos.");
        } else {
          setError("Não foi possível fazer login agora. Tente novamente em instantes.");
        }
        setLoginLoading(false);
        try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
        return;
      }

      // Sessão emitida server-side: hidrata cliente.
      clearAllRecoveryFlags();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token,
      });
      if (sessionError) {
        loginFlowLog("setSession-error", { message: sessionError.message });
        setError("Erro ao estabelecer sessão. Tente novamente.");
        setLoginLoading(false);
        try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
        return;
      }
      loginFlowLog("setSession-ok");
      if (await checkDeactivatedAfterLogin(cleaned)) return;

      void storeCredentials(cleaned, password);
      const target = resolvePostAuthRedirect(location.search);
      loginFlowLog("navigate", { target: target ?? "/" });
      navigate(target ?? "/", { replace: true });
      try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
    } catch (unexpectedError) {
      loginFlowLog("unexpected-error", {
        message: unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError),
      });
      toast({
        title: "Erro",
        description: "Erro de conexão. Tente novamente.",
        variant: "destructive",
      });
      setLoginLoading(false);
      try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
    }
  };

  const isIdentified = phase === "identified";
  const isLoadingCpf = phase === "loading_cpf";

  return (
    <>
    <div className="min-h-dvh app-safe-area">
      {/* Form — buffer de scroll generoso (pb-[60vh]) garante que, com o teclado
          aberto, sempre haja espaço para rolar e trazer CPF/Senha acima do
          teclado em qualquer tamanho de tela, mesmo se a WebView não reduzir a
          viewport. O conteúdo (form + buffer) sempre excede a tela, então a
          página rola; o my-auto centraliza quando há espaço sobrando. */}
      <div className="min-h-dvh flex flex-col px-6 pt-12 pb-[60vh] bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50 relative">
        <button
          onClick={() => navigate("/")}
          className="absolute left-4 top-4 md:left-8 md:top-8 flex items-center gap-1 text-sm text-[#3D2B1F]/60 hover:text-[#3D2B1F] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <div className="w-full max-w-sm mx-auto my-auto animate-slide-up">
          <div className="text-center mb-8">
            <img src={logoHeader} alt="Recruta" className="h-16 mx-auto mb-6" />
            <h1 className="text-2xl font-bold text-[#3D2B1F]">
              Bem-vindo!
            </h1>
            <p className="text-sm text-[#3D2B1F]/60 mt-1">
              Recrutamento Inteligente
            </p>
          </div>

          <Card className="border-0 shadow-2xl">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold text-[#3D2B1F] text-center">
                {isIdentified ? "Acesse sua conta" : "Digite seu CPF para começar"}
              </CardTitle>
            </CardHeader>

            <CardContent>
              <form
                ref={formRef}
                onSubmit={handleSubmit}
                className="space-y-4"
                autoComplete="on"
              >
                {/* CPF Field — atua como "username" para Credential Manager */}
                <div className="space-y-1.5">
                  <Label htmlFor="login-cpf" className="text-[#3D2B1F]">CPF</Label>
                  <div className="relative">
                    <Input
                      id="login-cpf"
                      name="username"
                      type="text"
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      value={cpf}
                      onChange={handleCpfChange}
                      className="h-12 text-center text-lg tracking-wider focus-visible:ring-amber-500"
                      autoFocus
                      maxLength={14}
                      disabled={isLoadingCpf || loginLoading}
                      readOnly={isIdentified}
                      autoComplete="username"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      style={isIdentified ? { opacity: 0.85, cursor: "default" } : undefined}
                    />
                    {isLoadingCpf && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-amber-500" />
                    )}
                  </div>
                  {isIdentified && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium animate-fade-in">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Conta identificada
                    </p>
                  )}
                </div>

                {/* Password Field — só aparece após CPF identificado */}
                {isIdentified && (
                  <div className="space-y-1.5 animate-fade-in">
                    <Label htmlFor="login-password" className="text-[#3D2B1F]">Senha</Label>
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      value={cpf}
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                      className="sr-only"
                    />
                    <div className="relative">
                      <Input
                        id="login-password"
                        ref={passwordRef}
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        className="h-11 pr-11 focus-visible:ring-amber-500"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (error) setError("");
                        }}
                        disabled={loginLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        aria-pressed={showPassword}
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-md text-[#3D2B1F]/60 hover:text-[#3D2B1F] hover:bg-amber-100/60 transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-xs text-destructive animate-fade-in">{error}</p>
                )}

                {/* Submit button - only when identified */}
                {isIdentified && (
                  <div className="space-y-3 animate-fade-in">
                    <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} className="flex justify-center" />
                    <Button
                      type="submit"
                      className="w-full h-12 text-base font-semibold bg-amber-500 hover:bg-amber-600 text-white"
                      disabled={loginLoading || password.length < 6}
                    >
                      {loginLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Entrando...
                        </>
                      ) : (
                        "Entrar"
                      )}
                    </Button>

                    <Link
                      to="/auth/recuperar-senha"
                      state={{ cpf }}
                      className="block text-center text-sm text-amber-600 hover:text-amber-700 hover:underline"
                    >
                      Esqueci minha senha
                    </Link>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          <p className="text-xs text-[#3D2B1F]/50 text-center mt-6">
            Seus dados estão protegidos e serão usados
            <br />
            apenas para fins de recrutamento.
          </p>
        </div>
      </div>
    </div>

    <AlertDialog
      open={deactivatedDialog.open}
      onOpenChange={(open) => {
        setDeactivatedDialog((s) => ({ ...s, open }));
        if (!open) {
          try { window.sessionStorage?.removeItem(DEACTIVATED_PROMPT_KEY); } catch { /* ignore */ }
          try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
          try { window.sessionStorage?.removeItem(DEACTIVATED_SUPPRESS_TOAST_KEY); } catch { /* ignore */ }
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Conta desativada</AlertDialogTitle>
          <AlertDialogDescription>
            Identificamos que esta conta foi desativada. Deseja reativá-la? Para isso, vamos te levar ao cadastro para confirmar seus dados.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              setDeactivatedDialog({ open: false, cpf: "" });
              try { window.sessionStorage?.removeItem(DEACTIVATED_PROMPT_KEY); } catch { /* ignore */ }
              try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
              try { window.sessionStorage?.removeItem(DEACTIVATED_SUPPRESS_TOAST_KEY); } catch { /* ignore */ }
              sonnerToast.info("Tudo bem. Sua conta permanece desativada.");
            }}
          >
            Agora não
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const cleaned = deactivatedDialog.cpf;
              setDeactivatedDialog({ open: false, cpf: "" });
              try { window.sessionStorage?.removeItem(DEACTIVATED_PROMPT_KEY); } catch { /* ignore */ }
              try { window.sessionStorage?.removeItem(DEACTIVATED_LOGIN_PENDING_KEY); } catch { /* ignore */ }
              try { window.sessionStorage?.removeItem(DEACTIVATED_SUPPRESS_TOAST_KEY); } catch { /* ignore */ }
              navigate(`/auth/cadastro${location.search ?? ""}`, { state: { cpf: cleaned } });
            }}
          >
            Reativar conta
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
