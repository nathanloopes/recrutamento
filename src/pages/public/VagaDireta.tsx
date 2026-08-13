import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Briefcase, AlertCircle, Compass, Lock, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  resolveLinkIntent,
  applyViaLink,
  incrementLinkClick,
  type ResolveLinkIntent,
} from "@/hooks/useRecruitmentLinks";
import { toast } from "sonner";
import { ORIGIN_LINK_STORAGE_KEY as ORIGIN_STORAGE_KEY, clearPendingOriginLinkToken, setPendingOriginLinkToken, markInviteContext } from "@/lib/postAuthRedirect";

import { clearOriginDeeplink } from "@/lib/originDeeplink";
import { ResumeOptionalDialog } from "@/components/candidate/ResumeOptionalDialog";
import { useHasResume } from "@/hooks/useHasResume";

export default function VagaDireta() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading, isAdmin, hasRole } = useAuth();
  const navigate = useNavigate();
  const [intent, setIntent] = useState<ResolveLinkIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobInfo, setJobInfo] = useState<{ title?: string; description?: string } | null>(null);
  const [unitInfo, setUnitInfo] = useState<{ name?: string; city?: string; state?: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const { data: hasResume, refetch: refetchHasResume } = useHasResume();

  useEffect(() => {
    if (!token) return;
    // Persistência defensiva do token de origem.
    setPendingOriginLinkToken(token);
    markInviteContext(`${window.location.origin}/v/${token}`);
    let cancelled = false;
    incrementLinkClick(token).catch(() => {});
    if (authLoading) return;

    // Admin/RH/Auditor não podem se candidatar via link — redireciona pro painel
    if (user && (isAdmin || hasRole("auditor_admin") || hasRole("rh_franqueadora"))) {
      toast.info("Links de divulgação são para candidatos. Faça logout para se candidatar.");
      navigate("/admin", { replace: true });
      return;
    }

    (async () => {
      try {
        // Defesa: se o storage tem um token mas a sessão Supabase está expirada,
        // limpa antes de chamar a RPC para não autenticar como usuário antigo.
        try {
          const { data: sess } = await supabase.auth.getSession();
          const exp = sess?.session?.expires_at;
          if (exp && exp * 1000 < Date.now()) {
            await supabase.auth.signOut({ scope: "local" });
          }
        } catch { /* noop */ }

        const result = await resolveLinkIntent(token);
        if (cancelled) return;
        setIntent(result);

        // Pré-carrega dados de cargo e unidade para preview/B (se houver)
        if (result.job_id) {
          const { data } = await (supabase.from("jobs") as any)
            .select("title, description")
            .eq("id", result.job_id)
            .maybeSingle();
          if (!cancelled && data) setJobInfo(data);
        }
        if (result.unit_id) {
          const { data } = await (supabase.from("units") as any)
            .select("name, city, state")
            .eq("id", result.unit_id)
            .maybeSingle();
          if (!cancelled && data) setUnitInfo(data);
        }

        // login_required → guarda token e manda pra /auth
        if (result.verdict === "login_required" && !user) {
          sessionStorage.setItem(ORIGIN_STORAGE_KEY, token);
          navigate(`/auth?next=${encodeURIComponent(`/v/${token}`)}`, { replace: true });
          return;
        }

        // redirect_discovery → grava origem em sessionStorage para futura application
        if (result.verdict === "redirect_discovery" && result.origin_link_id) {
          sessionStorage.setItem(ORIGIN_STORAGE_KEY, token);
        }

        // Push "essa oportunidade já passou" (best-effort, dedup garantido no backend)
        if (
          result.verdict === "redirect_discovery" &&
          result.reason === "already_attempted_this_job" &&
          user
        ) {
          supabase.functions
            .invoke("notify-link-opportunity-passed", { body: { token } })
            .catch((err) => console.warn("notify-link-opportunity-passed failed:", err));
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Erro ao carregar link");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token, authLoading, user, navigate, isAdmin, hasRole]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !intent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <div className="text-lg font-semibold">Link inválido</div>
            <p className="text-sm text-muted-foreground">{error ?? "Não foi possível carregar este link."}</p>
            <Button asChild className="mt-2"><Link to="/">Ir para o portal</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const unitLocation = [unitInfo?.city, unitInfo?.state].filter(Boolean).join(" / ");

  // ============== A) BLOCKED — já tem candidatura ativa ==============
  if (intent.verdict === "blocked_active") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-warning" />
              <CardTitle>Você já está em processo</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Você já tem uma candidatura ativa em andamento. Acompanhe o progresso para ver os próximos passos.
            </p>
            <Button asChild className="w-full">
              <Link to="/candidaturas">Ver minha candidatura</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============== B1) JÁ PASSOU POR ESSA VAGA — variante dedicada ==============
  if (intent.verdict === "redirect_discovery" && intent.reason === "already_attempted_this_job") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              <CardTitle>Essa oportunidade já passou</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Você já participou desse processo em algum momento. Mas o portal tem várias outras oportunidades esperando — vamos dar uma olhada juntos?
            </p>
            <Button asChild className="w-full">
              <Link to={user ? "/oportunidades" : `/auth/cadastro?next=${encodeURIComponent("/oportunidades")}`}>
                {user ? "Explorar outras vagas" : "Cadastre-se e explore vagas"}
              </Link>
            </Button>
            {user && (
              <Button asChild variant="outline" className="w-full">
                <Link to="/candidaturas">Ver candidatura anterior</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============== B/C) REDIRECT TO DISCOVERY (demais motivos) ==============
  if (intent.verdict === "redirect_discovery") {
    const reasonText: Record<string, string> = {
      link_inactive: "Esse link não está mais ativo, mas o portal tem outras oportunidades.",
      unit_job_inactive: "Essa vaga não está mais aberta no momento. Veja outras oportunidades disponíveis.",
      pipeline_inactive: "Essa vaga ainda está sendo configurada. Enquanto isso, conheça outras oportunidades.",
      link_not_found: "Esse link não foi encontrado, mas você pode explorar todas as vagas pelo portal.",
    };
    const text = intent.reason ? reasonText[intent.reason] ?? reasonText.link_not_found : reasonText.link_not_found;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Compass className="h-5 w-5 text-primary" />
              <CardTitle>Descubra outras oportunidades</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{text}</p>
            <Button asChild className="w-full">
              <Link to={user ? "/oportunidades" : `/auth/cadastro?next=${encodeURIComponent("/oportunidades")}`}>
                {user ? "Explorar vagas" : "Cadastre-se e explore vagas"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============== D) APPLY (caminho feliz) ==============
  async function performApply() {
    if (!token) return;
    setApplying(true);
    try {
      const res = await applyViaLink(token);
      if (res.verdict === "applied") {
        clearPendingOriginLinkToken();
        clearOriginDeeplink();
        // Push de boas-vindas (best-effort, não bloqueia o redirect)
        if ((res as any).application_id) {
          supabase.functions.invoke("notify-link-origin-welcome", {
            body: { application_id: (res as any).application_id },
          }).catch((err) => console.warn("notify-link-origin-welcome failed:", err));
        }
        toast.success("Candidatura registrada!");
        navigate("/candidaturas", { replace: true });
      } else {
        // veredito mudou (ex: race condition) — recarrega para mostrar nova tela
        setIntent(res);
      }
    } catch (e: any) {
      toast.error("Erro ao se candidatar: " + (e.message ?? "desconhecido"));
    } finally {
      setApplying(false);
    }
  }

  async function handleApply() {
    if (!token) return;
    // Gate opcional de currículo: se ainda não tem, oferece anexar
    // antes de registrar interesse. Pular = segue normalmente.
    if (hasResume === false) {
      setResumeDialogOpen(true);
      return;
    }
    await performApply();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="space-y-2">
          <Badge variant="secondary" className="w-fit">Vaga em destaque para você</Badge>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            {jobInfo?.title ?? "Carregando vaga..."}
          </CardTitle>
          {unitInfo?.name && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" /> {unitInfo.name}{unitLocation ? ` · ${unitLocation}` : ""}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {jobInfo?.description && (
            <p className="text-sm text-foreground/80 line-clamp-6 whitespace-pre-line">{jobInfo.description}</p>
          )}
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            Ao continuar, você inicia o processo seletivo. Pode haver um teste antes de finalizar a candidatura.
          </div>
          <Button onClick={handleApply} disabled={applying} className="w-full" size="lg">
            {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Quero me candidatar
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/oportunidades">Ver outras vagas</Link>
          </Button>
        </CardContent>
      </Card>

      {/* Gate opcional de currículo antes de registrar interesse via link direto */}
      <ResumeOptionalDialog
        open={resumeDialogOpen}
        onOpenChange={setResumeDialogOpen}
        onContinue={async () => {
          await refetchHasResume();
          await performApply();
        }}
      />
    </div>
  );
}
