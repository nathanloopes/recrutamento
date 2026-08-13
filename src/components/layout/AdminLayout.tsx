import { useState, useRef, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { isWebView } from "@/lib/webviewCleanup";

import { AdminBottomNav } from "./AdminBottomNav";
import { PageTransition } from "./PageTransition";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";
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

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, isAdmin, isAuditor, hasRole, signOut } = useAuth();
  const isHome = location.pathname === "/admin";
  const isConversation = /^\/admin\/mensagens\/.+/.test(location.pathname);
  useConversationOutbox();

  const [searchOpen, setSearchOpen] = useState(false);
  // Notificações NUNCA são marcadas como lidas em route change.
  // Apenas o clique do usuário em uma notificação a marca como lida.
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);


  const roleName = hasRole("admin")
    ? "Administrador"
    : hasRole("rh_franqueadora")
      ? "Admin Franquia"
      : hasRole("franqueado")
        ? "Franqueado"
        : hasRole("gestor_recrutamento")
          ? "Gestor de Recrutamento"
          : isAuditor
            ? "Auditor"
            : "Usuário";

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
        <header className="sticky top-0 z-40 border-b flex items-center justify-between px-2 sm:px-4 bg-card shrink-0 safe-top safe-left safe-right" style={{ minHeight: 'calc(3.75rem + env(safe-area-inset-top, 0px))', paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))', paddingBottom: '0.5rem' }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {!isHome && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
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
                    {roleName}
                  </span>
                </div>
              </div>
            ) : (
              <h1 className="text-sm font-semibold text-foreground">
                Painel Administrativo
              </h1>
            )}
          </div>
          <div className="flex items-center shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" title="Buscar (Ctrl+K)" onClick={() => setSearchOpen(true)}>
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={handleLogout} title="Sair">
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
            : "flex-1 p-3 sm:p-4 md:p-6 overflow-x-hidden overflow-y-auto"
        }
        style={
          !isConversation
            ? { paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px) + 1.5rem)' }
            : undefined
        }
      >
        {isConversation ? (
          <div className="flex-1 min-h-0 flex flex-col"><Outlet /></div>
        ) : (
          <PageTransition><Outlet /></PageTransition>
        )}
      </main>
      {!isConversation && <AdminBottomNav />}
      <AdminCommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AIDisclosureModal />
    </div>
  );
}
