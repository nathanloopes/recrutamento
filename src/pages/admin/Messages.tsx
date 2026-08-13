import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Loader2, Search, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRecruiterThreadsPaged } from "@/hooks/useConversations";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type ReadFilter = "all" | "unread" | "read";

export default function AdminMessages() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReadFilter>("all");

  // Debounce 300ms para evitar requisições a cada tecla
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const {
    data,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRecruiterThreadsPaged(search, filter);

  const threads = useMemo(
    () => (data?.pages || []).flatMap((p: any) => p.items),
    [data]
  );

  // Sentinela para scroll infinito
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, threads.length]);

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground">Mensagens</h1>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar candidato por nome..."
          className="pl-9 pr-9"
          aria-label="Buscar candidato por nome"
        />
        {searchInput && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setSearchInput("")}
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "all", label: "Todas" },
          { key: "unread", label: "Não lidas" },
          { key: "read", label: "Lidas" },
        ] as const).map((opt) => {
          const active = filter === opt.key;
          return (
            <Button
              key={opt.key}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => setFilter(opt.key)}
              className={active ? "bg-amber-500 hover:bg-amber-600 text-amber-50" : ""}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>



      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : threads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30">
            <MessageCircle className="h-8 w-8 text-amber-600" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {search ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            {search
              ? `Nenhum candidato com "${search}" possui conversa aberta.`
              : "Abra uma conversa pelo botão \"Mensagem\" no card do candidato."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((t: any) => (
            <Card
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/admin/mensagens/${t.id}`)}
              className="cursor-pointer hover:border-amber-400 transition-colors border shadow-sm"
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                  <MessageCircle className="h-5 w-5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground truncate">{t.candidateName}</p>
                    {t.unreadCount > 0 && (
                      <Badge className="bg-amber-500 text-amber-50 text-[10px] shrink-0">
                        {t.unreadCount}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {t.jobTitle} · {t.unitName}
                  </p>
                  {t.lastMessage ? (
                    <p className="text-sm text-muted-foreground truncate mt-1">
                      {t.lastMessage.sender_role === "recrutador" ? "Você: " : ""}
                      {t.lastMessage.body}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic mt-1">Conversa aberta — aguardando primeira mensagem</p>
                  )}
                </div>
                {t.last_message_at && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(t.last_message_at), { locale: ptBR, addSuffix: false })}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Sentinela do scroll infinito */}
          <div ref={sentinelRef} className="h-8 flex items-center justify-center">
            {isFetchingNextPage && (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            {!hasNextPage && threads.length > 0 && (
              <span className="text-[10px] text-muted-foreground">Fim das conversas</span>
            )}
          </div>
        </div>
      )}

      {isFetching && !isLoading && !isFetchingNextPage && (
        <div className="flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
