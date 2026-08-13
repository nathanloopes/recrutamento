import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { isWebView, purgeAllClientStorage, notifyNativeShellLogout } from "@/lib/webviewCleanup";
import { reclaimPushSubscription, logoutPushSubscription } from "@/lib/webPush";
import { clearRecoveryMode, isRecoveryMode, isRecoveryPending } from "@/lib/recoveryMode";

const IDENTITY_DEVICE_SEED_KEY = "identity.device_seed";
const DEACTIVATED_PROMPT_KEY = "auth.deactivated_account_prompt";
const DEACTIVATED_LOGIN_PENDING_KEY = "auth.deactivated_login_pending";
const DEACTIVATED_SUPPRESS_TOAST_KEY = "suppress_deactivated_toast";

const authDebug = (_msg: string) => { /* silenced */ };
const authFlowLog = (_step: string, _details?: Record<string, unknown>) => { /* silenced */ };

// Guarda de módulo: garante que um logout dispare resetAuthState UMA única
// vez por ciclo, independentemente de quantos eventos SIGNED_OUT o Supabase
// emitir (espúrios de boot, refresh, multi-tab, hard reload pós-purge, etc.).
let logoutAlreadyHandled = false;

function getOrCreateIdentityDeviceSeed() {
  try {
    const existingSeed = window.localStorage.getItem(IDENTITY_DEVICE_SEED_KEY);
    if (existingSeed) return existingSeed;

    const newSeed = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(IDENTITY_DEVICE_SEED_KEY, newSeed);
    return newSeed;
  } catch {
    return `ephemeral-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function buildWebIdentityFingerprint() {
  if (typeof window === "undefined") return null;

  try {
    return {
      client_type: "web" as const,
      device_seed: getOrCreateIdentityDeviceSeed(),
      device_label: "Web Browser",
      platform: window.navigator?.platform || "unknown",
      user_agent: window.navigator?.userAgent || "unknown",
      language: window.navigator?.language || "unknown",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      app_version: "web",
      fingerprint_version: 1,
    };
  } catch {
    return null;
  }
}

function getSessionIdFromAccessToken(accessToken?: string | null) {
  if (!accessToken) return null;

  try {
    const [, payload] = accessToken.split(".");
    if (!payload) return null;

    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
    const decodedPayload = JSON.parse(window.atob(paddedPayload));

    return typeof decodedPayload.session_id === "string" ? decodedPayload.session_id : null;
  } catch {
    return null;
  }
}

interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  cep: string | null;
  avatar_url: string | null;
  city: string | null;
  state: string | null;
  birth_date: string | null;
  gender: string | null;
  address_json: Record<string, any> | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  profileLoaded: boolean;
  isAdmin: boolean;
  isAuditor: boolean;
  unitId: string | null;
  unitIds: string[];
  loading: boolean;
  authInitialized: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  profileLoaded: false,
  isAdmin: false,
  isAuditor: false,
  unitId: null,
  unitIds: [],
  loading: true,
  authInitialized: false,
  signOut: async () => {},
  refreshProfile: async () => {},
  hasRole: () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuditor, setIsAuditor] = useState(false);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);
  const profileLoadedForRef = useRef<string | null>(null);
  const registeringSessionIdRef = useRef<string | null>(null);
  const registeredSessionIdRef = useRef<string | null>(null);
  const isExplicitSignOutRef = useRef(false);

  const syncSessionState = useCallback((nextSession: Session | null) => {
    const nextUser = nextSession?.user ?? null;
    authFlowLog("syncSessionState", { hasSession: !!nextSession, hasUser: !!nextUser });
    activeUserIdRef.current = nextUser?.id ?? null;
    setSession(nextSession);
    setUser(nextUser);
  }, []);

  const resetAuthState = useCallback(() => {
    activeUserIdRef.current = null;
    profileLoadedForRef.current = null;
    registeringSessionIdRef.current = null;
    registeredSessionIdRef.current = null;
    setSession(null);
    setUser(null);
    setProfile(null);
    setProfileLoaded(true);
    setIsAdmin(false);
    setIsAuditor(false);
    setUnitId(null);
    setUnitIds([]);
    setRoles([]);
  }, []);

  const registerIdentityWebSession = useCallback((activeSession: Session | null) => {
    if (!activeSession?.access_token || typeof window === "undefined") return;

    const sessionId = getSessionIdFromAccessToken(activeSession.access_token);
    if (sessionId && (registeredSessionIdRef.current === sessionId || registeringSessionIdRef.current === sessionId)) {
      return;
    }

    if (sessionId) {
      registeringSessionIdRef.current = sessionId;
    }

    setTimeout(async () => {
      try {
        const hasDeactivatedLoginGuard = typeof window !== "undefined" && (
          window.sessionStorage?.getItem(DEACTIVATED_PROMPT_KEY) ||
          window.sessionStorage?.getItem(DEACTIVATED_SUPPRESS_TOAST_KEY)
        );
        if (hasDeactivatedLoginGuard) {
          if (registeringSessionIdRef.current === sessionId) {
            registeringSessionIdRef.current = null;
          }
          return;
        }

        const { data: { session: currentSession } } = await supabase.auth.getSession();
        const currentSessionId = getSessionIdFromAccessToken(currentSession?.access_token);
        if (!currentSession?.access_token || (sessionId && currentSessionId !== sessionId)) {
          if (registeringSessionIdRef.current === sessionId) {
            registeringSessionIdRef.current = null;
          }
          return;
        }

        const fingerprint = buildWebIdentityFingerprint();
        if (!fingerprint) {
          if (registeringSessionIdRef.current === sessionId) {
            registeringSessionIdRef.current = null;
          }
          return;
        }

        void supabase.functions.invoke("register-web-session", {
          body: fingerprint,
          headers: {
            Authorization: `Bearer ${activeSession.access_token}`,
          },
        }).then(({ error }) => {
          if (error) {
            console.warn("[Identity] Falha silenciosa ao registrar sessão web:", error.message);
            if (registeringSessionIdRef.current === sessionId) {
              registeringSessionIdRef.current = null;
            }
            return;
          }

          if (sessionId) {
            registeredSessionIdRef.current = sessionId;
          }
          if (registeringSessionIdRef.current === sessionId) {
            registeringSessionIdRef.current = null;
          }
        }).catch((error) => {
          console.warn("[Identity] Falha silenciosa ao registrar sessão web:", error);
          if (registeringSessionIdRef.current === sessionId) {
            registeringSessionIdRef.current = null;
          }
        });
      } catch (error) {
        console.warn("[Identity] Registro silencioso da sessão web não pôde ser iniciado:", error);
        if (registeringSessionIdRef.current === sessionId) {
          registeringSessionIdRef.current = null;
        }
      }
    }, 250);
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    authFlowLog("loadProfile:start");
    // Módulo 1: candidates + candidate_profiles (tabelas literais)
    const { data: candidate, error: cErr } = await supabase
      .from("candidates")
      .select("id, cpf, is_active")
      .eq("id", userId)
      .single();

    // ── Conta desativada (soft-delete) ──────────────────────────────────
    // Se o candidate existe mas is_active=false, força signOut imediato e
    // mostra mensagem. O cadastro novamente com o mesmo CPF reativa.
    if (candidate && (candidate as any).is_active === false) {
      authFlowLog("loadProfile:deactivated-candidate");
      console.warn("[Auth] Conta desativada — forçando signOut");
      // Se a tela de Login está tratando esse caso (mostrando o dialog de reativação),
      // não duplicamos toast nem forçamos redirect.
      const suppress = typeof window !== "undefined"
        && window.sessionStorage?.getItem(DEACTIVATED_SUPPRESS_TOAST_KEY) === "1";
      const pendingLogin = typeof window !== "undefined"
        && !!window.sessionStorage?.getItem(DEACTIVATED_LOGIN_PENDING_KEY);
      try {
        if (typeof window !== "undefined") {
          window.sessionStorage?.setItem(DEACTIVATED_PROMPT_KEY, JSON.stringify({
            cpf: (candidate as any).cpf || "",
            at: Date.now(),
          }));
          window.sessionStorage?.setItem(DEACTIVATED_SUPPRESS_TOAST_KEY, "1");
        }
      } catch { /* ignore */ }
      try {
        isExplicitSignOutRef.current = true;
        await supabase.auth.signOut();
      } catch { /* ignore */ }
      if (!suppress && !pendingLogin) {
        try {
          if (typeof window !== "undefined") {
            if (!window.location.pathname.startsWith("/auth")) {
              window.location.replace("/auth");
            }
          }
        } catch { /* ignore */ }
      }
      return;
    }

    const { data: cp, error: cpErr } = await supabase
      .from("candidate_profiles")
      .select("full_name, email, phone, cep, photo_url, city, state, birth_date, gender, address_json")
      .eq("candidate_id", userId)
      .single();

    const data = candidate && cp ? {
      id: candidate.id,
      cpf: candidate.cpf,
      full_name: cp.full_name,
      email: cp.email,
      phone: cp.phone,
      cep: cp.cep,
      avatar_url: cp.photo_url,
      city: cp.city,
      state: cp.state,
      birth_date: cp.birth_date,
      gender: cp.gender,
      address_json: cp.address_json as Record<string, any> | null,
    } : null;

    // Detect "missing-rows" (PGRST116) — true profile-not-found vs RLS/network errors.
    const candidateMissing = (cErr as any)?.code === "PGRST116";
    const profileMissing = (cpErr as any)?.code === "PGRST116";
    authFlowLog("loadProfile:profile-rows", {
      hasCandidate: !!candidate,
      hasCandidateProfile: !!cp,
      candidateErrorCode: (cErr as any)?.code ?? null,
      profileErrorCode: (cpErr as any)?.code ?? null,
    });

    if (data) {
      setProfile(data);
    } else if (cErr || cpErr) {
      console.error("[Auth] Falha ao carregar perfil:", cErr || cpErr);
    }

    // Check admin role
    const { data: hasAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { data: hasRH } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "rh_franqueadora",
    });
    const { data: hasAuditor } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "auditor_admin",
    });
    const { data: hasFranqueado } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "franqueado",
    });
    const { data: hasGestor } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "gestor_recrutamento",
    });
    authFlowLog("loadProfile:roles", {
      admin: !!hasAdmin,
      rh: !!hasRH,
      auditor: !!hasAuditor,
      franqueado: !!hasFranqueado,
      gestor: !!hasGestor,
    });
    setIsAdmin(!!hasAdmin || !!hasRH || !!hasFranqueado || !!hasGestor);
    setIsAuditor(!!hasAuditor);
    const detectedRoles: string[] = [];
    if (hasAdmin) detectedRoles.push("admin");
    if (hasRH) detectedRoles.push("rh_franqueadora");
    if (hasAuditor) detectedRoles.push("auditor_admin");
    if (hasFranqueado) detectedRoles.push("franqueado");
    if (hasGestor) detectedRoles.push("gestor_recrutamento");
    setRoles(detectedRoles);

    // Load unit_ids for scoped roles (franqueado/gestor/rh_franqueadora).
    // Leitura direta em user_roles: a policy "Users read own roles"
    // (user_id = auth.uid()) garante que o próprio usuário sempre enxerga
    // seus vínculos, mesmo após alteração de perfil.
    if (hasFranqueado || hasGestor || hasRH) {
      const { data: scopedRows, error: scopedErr } = await supabase
        .from("user_roles")
        .select("unit_id")
        .eq("user_id", userId)
        .in("role", ["franqueado", "gestor_recrutamento", "rh_franqueadora"] as any)
        .not("unit_id", "is", null);
      if (scopedErr) {
        console.error("[Auth] Falha ao carregar unidades do usuário:", scopedErr);
      }
      const ids = Array.from(
        new Set(((scopedRows as { unit_id: string | null }[] | null) || [])
          .map((r) => r.unit_id)
          .filter((v): v is string => !!v))
      );
      authFlowLog("loadProfile:unit-scope", { unitCount: ids.length });
      setUnitIds(ids);
      setUnitId(ids[0] || null);
    } else {
      setUnitIds([]);
      setUnitId(null);
    }

    profileLoadedForRef.current = userId;

    // ── Conta órfã: usuário do auth existe mas o perfil foi excluído ──
    // Se NÃO há candidate/candidate_profile (PGRST116 = no rows) E não há
    // nenhum role administrativo, o perfil foi deletado. Forçar signOut
    // imediatamente para nunca cair na home com sessão "fantasma".
    const hasAnyRole = !!(hasAdmin || hasRH || hasAuditor || hasFranqueado || hasGestor);
    const profileDeleted = (candidateMissing || profileMissing) && !data && !hasAnyRole;

    if (profileDeleted) {
      authFlowLog("loadProfile:profile-deleted-signout");
      console.warn("[Auth] Perfil inexistente para sessão ativa — forçando signOut");
      try {
        isExplicitSignOutRef.current = true;
        await supabase.auth.signOut();
      } catch { /* ignore */ }
      try {
        if (typeof window !== "undefined") {
          window.location.replace("/login");
        }
      } catch { /* ignore */ }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  useEffect(() => {
    let mounted = true;
    // Flag to avoid double-processing between onAuthStateChange (INITIAL_SESSION)
    // and getSession — getSession handles the initial load exclusively.
    let initialSessionLoaded = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        authDebug(`onAuthStateChange | event=${event} | hasSession=${!!newSession} | initialLoaded=${initialSessionLoaded}`);
        if (!mounted) return;

        // During initial load, only sync session/user refs — getSession handles
        // profile loading and setLoading(false) to avoid race conditions.
        if (!initialSessionLoaded) {
          authDebug("initial load — delegating to getSession");
          syncSessionState(newSession);
          setAuthInitialized(true);
          return;
        }

        // Em modo recuperação (aba ou ciclo pendente), NÃO promover sessão a
        // login real. PASSWORD_RECOVERY ainda é processado pela tela
        // /reset-password. Eventos SIGNED_IN/TOKEN_REFRESHED são ignorados
        // até o usuário concluir login real com CPF+senha (que limpa as flags).
        // EXCEÇÃO: se o evento é SIGNED_IN e o usuário está em /auth (tela de
        // login normal), tratamos como login real e limpamos as flags presas
        // — caso contrário um recovery_pending órfão prende o login para sempre.
        const path = typeof window !== "undefined" ? window.location.pathname : "";
        const onLoginScreen = path === "/auth" || path === "/" || path.startsWith("/auth/");
        const onResetScreen = path === "/reset-password" || path === "/auth/recuperar-senha";
        if ((isRecoveryMode() || isRecoveryPending()) && event !== "SIGNED_OUT") {
          if (event === "SIGNED_IN" && onLoginScreen && !onResetScreen) {
            authDebug("SIGNED_IN em tela de login com recovery presa — limpando flags e seguindo");
            clearRecoveryMode();
            try { localStorage.removeItem("auth.recovery_pending"); } catch { /* noop */ }
          } else {
            authDebug(`recovery ativo (mode/pending) — evento ${event} ignorado pelo AuthContext`);
            return;
          }
        }

        if (event === "SIGNED_IN") {
          // Login real concluído: limpa qualquer flag de recuperação remanescente
          // para que o PublicRoute volte a redirecionar normalmente.
          clearRecoveryMode();
          logoutAlreadyHandled = false;          // Se o user_id mudou em rela\u00e7\u00e3o ao anterior, limpa qualquer cache
          // residual da conta anterior (queries hidratadas durante login\n          // intermedi\u00e1rio, etc.) ANTES de carregar o novo perfil.
          const prevId = activeUserIdRef.current;
          if (newSession?.user && prevId && prevId !== newSession.user.id) {
            try { queryClient.clear(); } catch { /* noop */ }
          }          // Reivindicar/re-vincular push token para o usuário recém-logado.
          // Garante "1 device token = 1 usuário ativo" mesmo quando o navegador
          // já tem uma PushSubscription persistida da conta anterior.
          if (newSession?.user) {
            setTimeout(() => {
              void reclaimPushSubscription();
            }, 0);
          }
        }

        const previousUserId = activeUserIdRef.current;

        syncSessionState(newSession);

        if (!newSession?.user) {
          if (!isExplicitSignOutRef.current) {
            authDebug("SIGNED_OUT espúrio bloqueado — UI preservada");
            return;
          }
          if (logoutAlreadyHandled) {
            authDebug("SIGNED_OUT ignorado (duplicado)");
            isExplicitSignOutRef.current = false;
            setLoading(false);
            return;
          }
          authDebug("SIGNED_OUT explícito — resetando estado");
          logoutAlreadyHandled = true;
          resetAuthState();
          setLoading(false);
          isExplicitSignOutRef.current = false;
          return;
        }

        if (event === "TOKEN_REFRESHED") {
          authDebug("TOKEN_REFRESHED — ignorado (sem reload)");
          return;
        }

        registerIdentityWebSession(newSession);

        const shouldReloadProfile =
          previousUserId !== newSession.user.id ||
          profileLoadedForRef.current !== newSession.user.id;

        authDebug(`shouldReloadProfile=${shouldReloadProfile} | event=${event} | userChanged=${previousUserId !== newSession.user.id}`);

        if (!shouldReloadProfile) {
          return;
        }

        authDebug("setLoading(true) — recarregando perfil");
        setProfileLoaded(false);
        setLoading(true);
        // Use setTimeout to avoid Supabase deadlock
        setTimeout(async () => {
          if (!mounted) return;
          try {
            await loadProfile(newSession.user.id);
          } catch {
            // Profile loading failed but user session is still valid
          } finally {
            if (mounted) setProfileLoaded(true);
          }
          authDebug("setLoading(false) — perfil recarregado");
          if (mounted) setLoading(false);
        }, 0);
      }
    );

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      authDebug(`getSession resultado | hasSession=${!!s}`);
      if (!mounted) return;

      // CRÍTICO: durante recuperação de senha (aba ativa OU ciclo pendente
      // persistido em localStorage), NUNCA tratar a sessão como login válido —
      // não carrega perfil, não registra sessão web, não grava access_logs.
      // O usuário precisa fazer login real com CPF+senha depois.
      if (isRecoveryMode() || isRecoveryPending()) {
        authDebug("recovery (mode/pending) no boot — sessão ignorada para o app");
        initialSessionLoaded = true;
        setAuthInitialized(true);
        setProfileLoaded(true);
        if (mounted) setLoading(false);
        return;
      }

      if (!s?.user) {
        authDebug("sessão vazia no boot — sem reset");
        initialSessionLoaded = true;
        setAuthInitialized(true);
        setProfileLoaded(true);
        if (mounted) setLoading(false);
        return;
      }

      syncSessionState(s);
      registerIdentityWebSession(s);
      setProfileLoaded(false);
      try {
        await loadProfile(s.user.id);
      } catch {
        // Profile loading failed
      } finally {
        setProfileLoaded(true);
      }
      // Reivindicar push token na carga inicial também (cobre reload com sessão persistida).
      setTimeout(() => { void reclaimPushSubscription(); }, 0);
      // Log access with device info (best-effort, aguarda JWT propagar)
      setTimeout(() => {
        void (async () => {
          try {
            const { logAccessSafe } = await import("@/lib/accessLogHelper");
            const ua = navigator.userAgent || "unknown";
            const deviceInfo = `${navigator.platform || "unknown"} | ${ua.substring(0, 120)}`;
            await logAccessSafe({
              user_id: s.user.id,
              event_type: "login",
              device_info: deviceInfo,
              ip_address: null,
              module_name: "auth",
              success: true,
            });
          } catch { /* best-effort */ }
        })();
      }, 250);

      // Sync last_login_at in admin_users (best-effort)
      try {
        await supabase
          .from("admin_users")
          .update({ last_login_at: new Date().toISOString() } as any)
          .eq("id", s.user.id);
      } catch { /* best-effort */ }

      initialSessionLoaded = true;
      setAuthInitialized(true);
      authDebug("setLoading(false) — carga inicial completa");
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile, registerIdentityWebSession, resetAuthState, syncSessionState]);

  // ── Detecta mudança de role do próprio usuário em tempo real ──
  // Quando admin altera user_roles, recarrega perfil/roles, limpa caches de
  // notificações e dispara evento para o NotificationsRealtimeProvider religar
  // o canal Realtime — evita receber notificações do role antigo sem reload.
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    const channel = supabase
      .channel(`user-roles-self:${userId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "user_roles",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          authDebug("user_roles change detected — reloading profile & resubscribing notifications");
          // Limpa caches do role anterior
          try {
            queryClient.removeQueries({ queryKey: ["my_notifications", userId] });
            queryClient.removeQueries({ queryKey: ["unread_count", userId] });
            queryClient.removeQueries({ queryKey: ["module_badges", userId] });
          } catch { /* noop */ }

          // Recarrega perfil e roles
          profileLoadedForRef.current = null;
          setProfileLoaded(false);
          setTimeout(async () => {
            try {
              await loadProfile(userId);
            } catch { /* noop */ }
            setProfileLoaded(true);
            // Notifica o provider de notificações para religar o canal
            try {
              window.dispatchEvent(
                new CustomEvent("auth:role-changed", { detail: { userId } })
              );
            } catch { /* noop */ }
          }, 0);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, loadProfile, queryClient]);

  const signOut = useCallback(async () => {
    const activeSession = session;
    const activeUser = user;
    const accessToken = activeSession?.access_token;

    // 1) Imediato (sub-50ms): marca logout explícito, limpa cache e estado React.
    // NÃO chamamos supabase.auth.signOut() aqui ainda — precisamos do token válido
    // para o access_logs (RLS) e para a edge function de revogação.
    isExplicitSignOutRef.current = true;
    logoutAlreadyHandled = true; // bloqueia o SIGNED_OUT que virá do listener
    queryClient.clear();
    resetAuthState();

    // CRÍTICO: remove o token do Supabase do localStorage SÍNCRONAMENTE para
    // evitar que uma reabertura imediata da app (ex.: clicar em /v/:token)
    // reidrate a sessão antiga antes do signOut local assíncrono concluir.
    try {
      const supabaseRef = (() => {
        try { return new URL(SUPABASE_URL).hostname.split(".")[0]; }
        catch { return "YOUR_PROJECT"; }
      })();
      window.localStorage.removeItem(`sb-${supabaseRef}-auth-token`);
    } catch (err) {
      console.warn("[Auth] não foi possível remover token do localStorage:", err);
    }

    const inWebView = isWebView();

    // 2) Background (não-bloqueante): dispara tarefas remotas com o token AINDA
    // válido, e só depois limpa o storage local do Supabase.
    setTimeout(() => {
      const tasks: Promise<unknown>[] = [];

      if (activeUser && accessToken) {
        const ua = navigator.userAgent || "unknown";
        const deviceInfo = `${navigator.platform || "unknown"} | ${ua.substring(0, 120)}`;
        tasks.push(
          fetch(`${SUPABASE_URL}/rest/v1/access_logs`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              user_id: activeUser.id,
              event_type: "logout",
              device_info: deviceInfo,
              module_name: "auth",
              success: true,
            }),
          }).catch((error) => {
            console.warn("[Auth] Falha ao registrar logout em access_logs:", error);
          })
        );
      }

      if (accessToken) {
        tasks.push(
          fetch(`${SUPABASE_URL}/functions/v1/revoke-identity-session`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ reason: "user_logout", scope: "current" }),
          }).catch((error) => {
            console.warn("[Auth] Falha ao revogar sessão no servidor (background):", error);
          })
        );

        // Desvincular push token do dispositivo: marca is_active=false no servidor
        // e faz unsubscribe no navegador para que o próximo login obtenha endpoint novo.
        // Garante que notificações da conta anterior NUNCA cheguem após troca de usuário.
        tasks.push(
          logoutPushSubscription(accessToken).catch((error) => {
            console.warn("[Auth] Falha ao desvincular push token (background):", error);
          })
        );
      }

      // Após as tarefas remotas terminarem (com sucesso ou falha), limpa o
      // storage local do Supabase. O usuário já foi redirecionado há muito tempo.
      void Promise.allSettled(tasks).finally(() => {
        void supabase.auth.signOut({ scope: "local" }).catch((error) => {
          console.warn("[Auth] signOut local falhou silenciosamente:", error);
        });
      });
    }, 0);

    // 3) Em WebView: signOut local SÍNCRONO + purge total + hard redirect.
    // Isso impede que o usuário toque no CPF antes do storage estar limpo.
    if (inWebView) {
      // Aguardar best-effort do unbind do push token (até 2.5s) ANTES do
      // hard redirect, para evitar race onde o token continua ativo na
      // conta anterior depois que a WebView é remontada.
      const pushTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
      const pushUnbind = logoutPushSubscription(accessToken).catch(() => { /* noop */ });
      void Promise.race([pushUnbind, pushTimeout]).finally(() => {
        try {
          void supabase.auth.signOut({ scope: "local" }).catch(() => { /* noop */ });
        } catch { /* noop */ }
        try { purgeAllClientStorage(); } catch { /* noop */ }
        try { notifyNativeShellLogout(); } catch { /* noop */ }
        try {
          window.location.replace(`/auth?_=${Date.now()}`);
        } catch { /* noop */ }
      });
    }
  }, [session, user, queryClient, resetAuthState]);


  const hasRoleFn = useCallback((role: string) => roles.includes(role), [roles]);

  return (
    <AuthContext.Provider value={{ user, session, profile, profileLoaded, isAdmin, isAuditor, unitId, unitIds, loading, authInitialized, signOut, refreshProfile, hasRole: hasRoleFn }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
