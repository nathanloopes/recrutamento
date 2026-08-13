import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Briefcase,
  GitBranch,
  MapPin,
  Building2,
  Users,
  Shield,
  Brain,
  CalendarDays,
  BookOpen,
  ScrollText,
  Bell,
  ClipboardList,
  Settings,
  ArrowRightLeft,
  HelpCircle,
  Plug,
  UserCheck,
  GitPullRequest,
  MessageSquare,
  Activity,
} from "lucide-react";
import { PageHelp } from "@/components/ui/page-help";
import { useModuleBadges } from "@/hooks/useModuleBadges";

interface ModuleItem {
  title: string;
  url: string;
  icon: React.ElementType;
  color: string;
}

const allRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento", "auditor_admin"];
const centralRoles = ["admin", "rh_franqueadora"];
const unitRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento"];
const auditRoles = ["admin", "rh_franqueadora", "auditor_admin"];

interface ModuleItemWithRoles extends ModuleItem {
  roles: string[];
}

const modules: ModuleItemWithRoles[] = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard, color: "bg-blue-500", roles: unitRoles },
  { title: "Cargos", url: "/admin/cargos", icon: Briefcase, color: "bg-emerald-500", roles: centralRoles },
  { title: "Pipelines", url: "/admin/pipelines", icon: GitBranch, color: "bg-violet-500", roles: centralRoles },
  { title: "Vagas", url: "/admin/vagas", icon: MapPin, color: "bg-orange-500", roles: unitRoles },
  { title: "Links de recrutamento", url: "/admin/links-recrutamento", icon: LayoutDashboard, color: "bg-amber-600", roles: unitRoles },
  { title: "Funil de Links", url: "/admin/dashboard-links", icon: LayoutDashboard, color: "bg-amber-700", roles: centralRoles },
  { title: "Unidades", url: "/admin/unidades", icon: Building2, color: "bg-amber-500", roles: centralRoles },
  { title: "Usuários", url: "/admin/usuarios", icon: Users, color: "bg-pink-500", roles: centralRoles },
  { title: "Auditoria", url: "/admin/logs", icon: Shield, color: "bg-red-500", roles: auditRoles },
  { title: "IA Avaliações", url: "/admin/ia-avaliacoes", icon: Brain, color: "bg-purple-500", roles: centralRoles },
  { title: "Banco de Talentos", url: "/admin/banco-de-talentos", icon: Users, color: "bg-teal-500", roles: unitRoles },
  { title: "Pipeline de Candidaturas", url: "/admin/talent-pipeline", icon: GitPullRequest, color: "bg-teal-600", roles: unitRoles },
  { title: "Plano de Carreira", url: "/admin/plano-carreira", icon: Brain, color: "bg-indigo-500", roles: centralRoles },
  { title: "Agendamento", url: "/admin/agendamento", icon: CalendarDays, color: "bg-green-500", roles: unitRoles },
  { title: "Roteiros", url: "/admin/roteiros", icon: BookOpen, color: "bg-cyan-500", roles: unitRoles },
  { title: "Documentação", url: "/admin/documentacao", icon: ScrollText, color: "bg-yellow-500", roles: unitRoles },
  { title: "Notificações", url: "/admin/notificacoes", icon: Bell, color: "bg-rose-500", roles: centralRoles },
  { title: "Configurações", url: "/admin/configuracoes", icon: Settings, color: "bg-slate-500", roles: ["admin"] },
  { title: "Migrações", url: "/admin/migracoes", icon: ArrowRightLeft, color: "bg-lime-600", roles: ["admin"] },
  { title: "FAQ", url: "/admin/faq", icon: HelpCircle, color: "bg-sky-500", roles: unitRoles },
  { title: "Mensagens", url: "/admin/mensagens", icon: MessageSquare, color: "bg-amber-500", roles: unitRoles },
  { title: "Colaboradores", url: "/admin/colaboradores", icon: UserCheck, color: "bg-emerald-600", roles: unitRoles },
  { title: "Testes", url: "/admin/testes", icon: ClipboardList, color: "bg-orange-600", roles: unitRoles },
  { title: "Integrações", url: "/admin/integracoes", icon: Plug, color: "bg-fuchsia-500", roles: ["admin"] },
  { title: "Saúde do Sistema", url: "/admin/saude-sistema", icon: Activity, color: "bg-green-600", roles: ["admin"] },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { profile, isAdmin, isAuditor, hasRole } = useAuth();
  const { data: moduleBadges } = useModuleBadges();

  const getModuleSlug = (url: string) => {
    const match = url.match(/^\/admin\/([\w-]+)/);
    return match ? match[1] : null;
  };

  const firstName = profile?.full_name?.split(" ")[0] ?? "Usuário";
  const roleName = isAdmin
    ? hasRole("admin") ? "Administrador"
    : hasRole("rh_franqueadora") ? "Admin Franquia"
    : hasRole("franqueado") ? "Franqueado"
    : hasRole("gestor_recrutamento") ? "Gestor de Recrutamento"
    : "Administrador"
    : isAuditor ? "Auditor" : "Usuário";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-foreground">
            {getGreeting()}, {firstName}! 👋
          </h1>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20">
            {roleName}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Gerencie todos os módulos do sistema
          </span>
        </div>
        </div>
        <PageHelp />
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Módulos
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 overflow-visible">
        {modules.filter(mod => mod.roles.some(r => hasRole(r))).map((mod, i) => (
          <div key={mod.url} className="relative animate-stagger-item pt-2 pr-2" style={{ "--stagger-index": i } as React.CSSProperties}>
            {(() => {
              const slug = getModuleSlug(mod.url);
              const count = slug ? moduleBadges[slug] || 0 : 0;
              return count > 0 ? (
                <span className="absolute top-0 right-0 z-10 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold shadow-sm">
                  {count > 99 ? "99+" : count}
                </span>
              ) : null;
            })()}
            <button
              onClick={() => navigate(mod.url)}
              className="w-full flex flex-col items-center gap-2.5 rounded-xl border border-border bg-card p-5 transition-all hover:bg-accent hover:shadow-md hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className={`flex items-center justify-center w-11 h-11 rounded-full ${mod.color} text-white`}>
                <mod.icon className="h-5 w-5" />
              </div>
              <span className="text-xs font-medium text-foreground text-center leading-tight">
                {mod.title}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
