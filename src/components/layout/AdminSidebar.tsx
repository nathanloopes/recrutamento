import {
  LayoutDashboard,
  Briefcase,
  GitBranch,
  Building2,
  Users,
  ScrollText,
  MapPin,
  LogOut,
  Settings,
  Brain,
  CalendarDays,
  BookOpen,
  Bell,
  HelpCircle,
  ArrowRightLeft,
  Shield,
  Plug,
  MessageSquare,
  UserCheck,
  ClipboardList,
  Mic,
  Activity,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useOpenQuestionsCount } from "@/hooks/useFAQ";
import { useAuth } from "@/contexts/AuthContext";
import { isWebView } from "@/lib/webviewCleanup";
import { useModuleBadges } from "@/hooks/useModuleBadges";
import { useActiveModules } from "@/hooks/useFeatureFlags";
import { useUnreadMessagesTotal } from "@/hooks/useConversations";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const centralRoles = ["admin", "rh_franqueadora"];
const unitRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento"];
const auditRoles = ["admin", "rh_franqueadora", "auditor_admin"];
const allAdminRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento", "auditor_admin"];

const navItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard, roles: allAdminRoles },
  { title: "Cargos", url: "/admin/cargos", icon: Briefcase, roles: centralRoles },
  { title: "Pipelines", url: "/admin/pipelines", icon: GitBranch, roles: centralRoles },
  { title: "Vagas", url: "/admin/vagas", icon: MapPin, roles: unitRoles },
  { title: "Links de recrutamento", url: "/admin/links-recrutamento", icon: LayoutDashboard, roles: unitRoles },
  { title: "Unidades", url: "/admin/unidades", icon: Building2, roles: centralRoles },
  { title: "Usuários", url: "/admin/usuarios", icon: Users, roles: centralRoles },
  { title: "Auditoria", url: "/admin/logs", icon: Shield, roles: auditRoles },
  { title: "IA Avaliações", url: "/admin/ia-avaliacoes", icon: Brain, roles: centralRoles },
  { title: "Banco de Talentos", url: "/admin/banco-de-talentos", icon: Users, roles: unitRoles },
  { title: "Pipeline de Candidaturas", url: "/admin/talent-pipeline", icon: GitBranch, roles: unitRoles },
  { title: "Plano de Carreira", url: "/admin/plano-carreira", icon: Brain, roles: centralRoles },
  { title: "Agendamento", url: "/admin/agendamento", icon: CalendarDays, roles: unitRoles },
  { title: "Roteiros", url: "/admin/roteiros", icon: BookOpen, roles: unitRoles },
  { title: "Entrevistas IA", url: "/admin/entrevistas-ia", icon: Mic, roles: unitRoles },
  { title: "Documentação", url: "/admin/documentacao", icon: ScrollText, roles: unitRoles },
  { title: "Minhas Notificações", url: "/admin/minhas-notificacoes", icon: Bell, roles: allAdminRoles },
  { title: "Gestão de Notificações", url: "/admin/notificacoes", icon: Bell, roles: centralRoles },
  { title: "Configurações", url: "/admin/configuracoes", icon: Settings, roles: ["admin"] },
  { title: "Migrações", url: "/admin/migracoes", icon: ArrowRightLeft, roles: ["admin"] },
  { title: "FAQ", url: "/admin/faq", icon: HelpCircle, roles: unitRoles },
  { title: "Chamados", url: "/admin/chamados", icon: MessageSquare, roles: unitRoles },
  { title: "Mensagens", url: "/admin/mensagens", icon: MessageSquare, roles: unitRoles },
  { title: "Colaboradores", url: "/admin/colaboradores", icon: UserCheck, roles: unitRoles },
  { title: "Testes", url: "/admin/testes", icon: ClipboardList, roles: unitRoles },
  { title: "Integrações", url: "/admin/integracoes", icon: Plug, roles: ["admin"] },
  { title: "Saúde do Sistema", url: "/admin/saude-sistema", icon: Activity, roles: ["admin"] },
];

// Full nav-to-module mapping for all toggleable modules
const NAV_TO_MODULE: Record<string, string> = {
  "/admin/ia-avaliacoes": "automated_evaluation",
  "/admin/banco-de-talentos": "talent_pool",
  "/admin/plano-carreira": "career_plan",
  "/admin/agendamento": "smart_scheduling",
  "/admin/roteiros": "ai_voice_interview",
  "/admin/entrevistas-ia": "ai_voice_interview",
  "/admin/notificacoes": "auto_notifications",
  "/admin/colaboradores": "human_interview",
  "/admin/testes": "automated_evaluation",
};

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const { data: openCount } = useOpenQuestionsCount();
  const { hasRole, signOut } = useAuth();
  const { data: moduleBadges } = useModuleBadges();
  const { data: unreadMessages } = useUnreadMessagesTotal();
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

  const visibleItems = navItems.filter(item => item.roles.some(r => hasRole(r)) && isModuleEnabled(item.url));

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (e) {
      console.error("[Auth] Erro ao sair:", e);
    }
    if (!isWebView()) navigate("/auth");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider">
            {!collapsed && "Recruta"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/admin"}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <div className="relative">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {item.title === "FAQ" && !!openCount && openCount > 0 && (
                          <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                            {openCount > 99 ? "99+" : openCount}
                          </span>
                        )}
                        {item.title === "Mensagens" && !!unreadMessages && unreadMessages > 0 && (
                          <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                            {unreadMessages > 99 ? "99+" : unreadMessages}
                          </span>
                        )}
                        {(() => {
                          const slug = getModuleSlug(item.url);
                          const count = slug ? moduleBadges[slug] || 0 : 0;
                          return item.title !== "FAQ" && item.title !== "Mensagens" && count > 0 ? (
                            <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                              {count > 99 ? "99+" : count}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "default"}
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
