import { Home, User, Briefcase, Bell, MessageCircle } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useUnreadCount } from "@/hooks/useNotifications";
import { useUnreadMessagesTotal } from "@/hooks/useConversations";

const navItems = [
  { to: "/inicio", icon: Home, label: "Início" },
  { to: "/mensagens", icon: MessageCircle, label: "Mensagens" },
  { to: "/candidaturas", icon: Briefcase, label: "Processos" },
  { to: "/notificacoes", icon: Bell, label: "Avisos" },
  { to: "/perfil", icon: User, label: "Perfil" },
];

export function BottomNav() {
  const { data: unreadCount } = useUnreadCount();
  const { data: unreadMsgs } = useUnreadMessagesTotal();

  return (
    <nav data-tour="bottom-nav" className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card safe-left safe-right overflow-hidden pwa-bottom-safe-area">
      <div className="flex items-center h-14 w-full">
        {navItems.map((item) => {
          const badgeCount =
            item.to === "/notificacoes" ? unreadCount ?? 0 :
            item.to === "/mensagens" ? unreadMsgs ?? 0 :
            0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/inicio"}
              className="flex-1 flex flex-col items-center gap-0.5 min-w-0 px-0.5 sm:px-2 py-2 text-muted-foreground transition-all duration-200 overflow-hidden"
              activeClassName="text-primary scale-110"
            >
              <div className="relative">
                <item.icon className="h-5 w-5 shrink-0" />
                {badgeCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                    {badgeCount > 9 ? "9+" : badgeCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium text-center leading-tight whitespace-nowrap">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
