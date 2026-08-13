import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCandidateThreads } from "@/hooks/useConversations";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatRowTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "ontem";
  return format(d, "dd/MM");
}

function initialOf(name?: string) {
  return (name?.trim()?.[0] || "?").toUpperCase();
}

export default function Messages() {
  const navigate = useNavigate();
  const { data: threads, isLoading } = useCandidateThreads();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const list = threads || [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((t: any) =>
      ["Sara", t.unitName, t.jobTitle, t.lastMessage?.body]
        .filter(Boolean)
        .some((s: string) => s.toLowerCase().includes(term))
    );

  }, [threads, q]);

  const totalUnread = (threads || []).reduce((acc: number, t: any) => acc + (t.unreadCount || 0), 0);

  return (
    <div className="-mx-4 -mt-4 flex flex-col">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 bg-card border-b border-border/40 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h1 className="text-xl font-display font-bold text-foreground">Mensagens</h1>
          {totalUnread > 0 && (
            <span className="text-xs font-medium text-amber-600">{totalUnread} não lida{totalUnread > 1 ? "s" : ""}</span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversa"
            className="pl-9 h-9 rounded-full bg-muted/60 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 pt-2">

        {isLoading ? (
          <div className="divide-y divide-border/40">
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
                <div className="w-12 h-12 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !threads || threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6 space-y-3">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30">
              <MessageCircle className="h-8 w-8 text-amber-600" />
            </div>
            <p className="text-sm font-medium text-foreground">Nenhuma mensagem ainda</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              A unidade entrará em contato por aqui quando precisar falar com você.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-12">Nenhum resultado para "{q}".</p>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((t: any) => {
              const mineLast = t.lastMessage?.sender_role === "candidato";
              const unread = t.unreadCount || 0;
              return (
                <button
                  key={t.id}
                  onClick={() => navigate(`/mensagens/${t.id}`)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/40 active:bg-muted/60 transition-colors"
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0 text-amber-50 font-semibold text-base shadow-sm">
                    S
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${unread > 0 ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                        Sara
                      </p>
                      <span className={`text-[11px] shrink-0 ${unread > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                        {formatRowTime(t.last_message_at)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{t.jobTitle} · {t.unitName}</p>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className={`text-xs truncate ${unread > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                        {t.lastMessage ? (
                          <>
                            {mineLast && <span className="text-muted-foreground">Você: </span>}
                            {t.lastMessage.body}
                          </>
                        ) : (
                          <span className="italic text-muted-foreground">Aguardando primeira mensagem</span>
                        )}
                      </p>
                      {unread > 0 && (
                        <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-amber-50 text-[10px] font-semibold flex items-center justify-center">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
