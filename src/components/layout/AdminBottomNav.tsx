import { cn } from "@/lib/utils";
import { Home, Briefcase, Users, BarChart3, UserCircle, Brain, Bell, MessageSquare } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadCount } from "@/hooks/useNotifications";
import { useModuleBadges } from "@/hooks/useModuleBadges";
import { useActiveModules } from "@/hooks/useFeatureFlags";
import { useUnreadMessagesTotal } from "@/hooks/useConversations";


interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  roles: string[];
}

const centralRoles = ["admin", "rh_franqueadora"];
const unitRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento"];
const allAdminRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento", "auditor_admin"];

const navItems: NavItem[] = [
  { to: "/admin", icon: Home, label: "Home", roles: allAdminRoles },
  { to: "/admin/vagas", icon: Briefcase, label: "Vagas", roles: unitRoles },
  { to: "/admin/candidatos-disponiveis", icon: Users, label: "Candidatos", roles: ["franqueado", "gestor_recrutamento"] },
  { to: "/admin/mensagens", icon: MessageSquare, label: "Mensagens", roles: unitRoles },
  { to: "/admin/minhas-notificacoes", icon: Bell, label: "Notificações", roles: allAdminRoles },
  { to: "/admin/usuarios", icon: Users, label: "Usuários", roles: centralRoles },
  { to: "/admin/perfil", icon: UserCircle, label: "Perfil", roles: allAdminRoles },
];

// Map nav URLs to feature flag module names
const NAV_TO_MODULE: Record<string, string> = {
  "/admin/ia-avaliacoes": "automated_evaluation",
  "/admin/banco-de-talentos": "talent_pool",
  "/admin/plano-carreira": "career_plan",
  "/admin/agendamento": "smart_scheduling",
};

export function AdminBottomNav() {
  const { hasRole } = useAuth();
  const { data: unreadCount } = useUnreadCount();
  const { data: unreadMessages } = useUnreadMessagesTotal();
  const { data: moduleBadges } = useModuleBadges();
  const { activeModules, featureControlEnabled } = useActiveModules();

  const isModuleEnabled = (url: string) => {
    if (!featureControlEnabled) return true;
    const moduleName = NAV_TO_MODULE[url];
    if (!moduleName) return true;
    return activeModules.includes(moduleName);
  };

  const getModuleSlug = (url: string) => {
    const match = url.match(/^\/admin\/([\w-]+)/);
    return match ? match[1] : null;
  };

  const visibleItems = navItems.filter(item => item.roles.some(r => hasRole(r)) && isModuleEnabled(item.to));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card safe-left safe-right overflow-hidden pwa-bottom-safe-area">
      <div className="flex items-center h-14 w-full">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/admin"}
            className="flex-1 flex flex-col items-center gap-0.5 min-w-0 px-0.5 sm:px-2 py-2 text-muted-foreground transition-all duration-200 relative overflow-hidden"
            activeClassName="text-primary scale-105"
          >
            <div className="relative">
              <item.icon className="h-5 w-5 shrink-0" />
              {item.to === "/admin/minhas-notificacoes" && (unreadCount ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                  {unreadCount! > 9 ? "9+" : unreadCount}
                </span>
              )}
              {item.to === "/admin/mensagens" && (unreadMessages ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                  {unreadMessages! > 9 ? "9+" : unreadMessages}
                </span>
              )}
              {item.to !== "/admin/minhas-notificacoes" && item.to !== "/admin/mensagens" && (() => {
                const slug = getModuleSlug(item.to);
                const count = slug ? moduleBadges[slug] || 0 : 0;
                return count > 0 ? (
                  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null;
              })()}
            </div>
            <span className={cn(
              "font-medium text-center leading-tight",
              item.label.length > 9 ? "text-[9px] tracking-tight" : "text-[10px] truncate",
              "max-w-full min-w-0"
            )}>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
