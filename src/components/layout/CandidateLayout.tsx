import { useRef, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { PageTransition } from "./PageTransition";
import { isWebView } from "@/lib/webviewCleanup";
import { EnableWebPushBanner } from "@/components/notifications/EnableWebPushBanner";
import { useConversationOutbox } from "@/hooks/useConversationOutbox";
import { AIDisclosureModal } from "@/components/AIDisclosureModal";

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

const PAGE_TITLES: Record<string, string> = {
  "/oportunidades": "Encontrar Vaga",
  "/unidades-disponiveis": "Unidades Disponíveis",
  "/candidaturas": "Processo Seletivo",
  "/notificacoes": "Avisos",
  "/perfil": "Meu Perfil",
  "/faq": "Ajuda",
  "/banco-talentos": "Meu Perfil de Talentos",
  "/banco-de-talentos": "Meu Perfil de Talentos",
  "/lista-oportunidade": "Convites Recebidos",
  "/mensagens": "Mensagens",
};

export function CandidateLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const mainRef = useRef<HTMLDivElement>(null);
  const isHome = location.pathname === "/inicio";
  const isConversation = /^\/mensagens\/.+/.test(location.pathname);
  useConversationOutbox();

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);


  const pageTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith("/documentos") ? "Documentos" : "");

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (e) {
      console.error("[Auth] Erro ao sair:", e);
    }
    if (!isWebView()) navigate("/auth");
  };

  return (
    <div className={isConversation ? "h-real-screen flex flex-col bg-background overflow-hidden" : "h-real-screen flex flex-col bg-background overflow-x-hidden"}>
      {!isConversation && (
        <header className="sticky top-0 z-40 border-b flex items-center justify-between px-2 sm:px-4 md:px-6 bg-card shrink-0 safe-top safe-left safe-right" style={{ minHeight: 'calc(3.75rem + env(safe-area-inset-top, 0px))', paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))', paddingBottom: '0.5rem' }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {!isHome && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/inicio")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {isHome && profile ? (
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <Avatar className="h-8 w-8 sm:h-9 sm:w-9 shrink-0">
                  <AvatarImage src={profile.avatar_url ?? undefined} alt={profile.full_name} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                    {getInitials(profile.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-foreground leading-tight truncate">
                    {profile.full_name}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight">
                    Candidato
                  </span>
                </div>
              </div>
            ) : (
              <h1 className="text-sm font-semibold text-foreground">
                {pageTitle || "Painel do Candidato"}
              </h1>
            )}
          </div>
          <div className="flex items-center shrink-0">
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
      )}
      {!isConversation && <EnableWebPushBanner />}
      <main
        ref={mainRef}
        className={
          isConversation
            ? "flex-1 min-h-0 overflow-hidden flex flex-col"
            : "flex-1 overflow-x-hidden overflow-y-auto"
        }
      >
        {isConversation ? (
          <div className="flex-1 min-h-0 flex flex-col"><Outlet /></div>
        ) : (
          // Full-width no desktop (mesmo padrão do AdminLayout). Páginas do candidato
          // controlam o próprio grid/espaço interno; a coluna estreita "mobile" continua
          // presente naturalmente porque as breakpoints só ampliam em sm/md/lg.
          <PageTransition><Outlet /></PageTransition>
        )}
        {!isConversation && <div aria-hidden className="h-24 shrink-0" />}
      </main>
      {!isConversation && <BottomNav />}
      <AIDisclosureModal />
    </div>
  );
}
