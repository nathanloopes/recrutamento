import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Loader2, Lock, Check, CheckCheck, Clock, AlertCircle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useThread, useThreadMessages, useSendMessage, type ConversationMessage } from "@/hooks/useConversations";
import { useMarkConversationNotificationsRead } from "@/hooks/useNotifications";
import { useConversationOutbox } from "@/hooks/useConversationOutbox";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { stickToBottomUntilStable } from "@/lib/chatInitialScroll";
import { useKeyboardOpenClass } from "@/lib/useKeyboardOpenClass";
import { formatChatDayLabel } from "@/lib/dateUtils";

function initialOf(name?: string) {
  return (name?.trim()?.[0] || "?").toUpperCase();
}

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; msg: ConversationMessage; mine: boolean; isLastOfGroup: boolean };

export default function Conversation() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: thread, isLoading: loadingThread } = useThread(threadId);
  const { data: messages, isLoading: loadingMsgs } = useThreadMessages(threadId);
  const send = useSendMessage(threadId);
  const outbox = useConversationOutbox();
  useMarkConversationNotificationsRead(threadId);
  useKeyboardOpenClass();
  const [draft, setDraft] = useState("");
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };


  // Auto-grow do composer até 10 linhas; depois ativa scroll
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = window.getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const max = lh * 10 + pad + border;
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const isClosed = thread?.status === "closed";
  const unitName = thread?.applications?.unit_jobs?.units?.name || "Unidade";
  const jobTitle = thread?.applications?.unit_jobs?.jobs?.title || "Vaga";
  // Persona única visível ao candidato: "Sara" — IA e humanos respondem como Sara.
  const personaName = "Sara";
  const personaInitial = "S";
  const personaSubtitle = isClosed
    ? null
    : `${jobTitle} · ${unitName}`;


  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (!messages || messages.length === 0) return out;
    let lastDay: Date | null = null;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const next = messages[i + 1];
      const d = new Date(m.created_at);
      if (!lastDay || !isSameDay(lastDay, d)) {
        out.push({ kind: "day", key: `day-${d.toDateString()}`, label: formatChatDayLabel(d) });
        lastDay = d;
      }
      const mine = m.sender_id === user?.id;
      const isLastOfGroup =
        !next ||
        next.sender_id !== m.sender_id ||
        !isSameDay(new Date(next.created_at), d);
      out.push({ kind: "msg", key: m.id, msg: m, mine, isLastOfGroup });
    }
    return out;
  }, [messages, user?.id]);

  // Sem autofocus ao abrir: evita abrir o teclado em PWA/mobile.

  // Track if user is at bottom before new messages arrive
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const didInitialScrollRef = useRef(false);
  const stickStopRef = useRef<null | (() => void)>(null);

  // Reset ao trocar de thread
  useEffect(() => {
    didInitialScrollRef.current = false;
    stickStopRef.current?.();
    stickStopRef.current = null;
  }, [threadId]);

  // Scroll inicial robusto: cola no final até o layout estabilizar
  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return;
    if (loadingMsgs || !messages || messages.length === 0) return;
    const el =
      scrollRef.current ||
      (document.querySelector(".chat-messages") as HTMLElement | null);
    if (!el) return;
    didInitialScrollRef.current = true;
    // snap síncrono imediato (antes do paint) — evita flash no topo em PWA
    el.scrollTop = el.scrollHeight;
    stickStopRef.current = stickToBottomUntilStable(el);
    return () => {
      stickStopRef.current?.();
      stickStopRef.current = null;
    };
  }, [threadId, messages, loadingMsgs]);

  // Mantém no final apenas quando o usuário já estava no final e novas mensagens chegam
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      wasAtBottomRef.current = true;
      await send.mutateAsync(body);
      setDraft("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e: any) {
      toast({ title: "Não foi possível enviar", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="chat-root chat-module bg-muted/20">

      {/* Header */}
      <div className="px-2 py-2 border-b border-border/40 bg-card flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/mensagens")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0 text-amber-50 font-semibold text-sm shadow-sm">
          {personaInitial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate text-foreground">{personaName}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {isClosed ? (
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" /> Encerrada
              </span>
            ) : (
              personaSubtitle
            )}
          </p>
        </div>

      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-messages px-3 py-4"
        style={{
          backgroundImage:
            "radial-gradient(hsl(var(--muted-foreground) / 0.08) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        {loadingThread || loadingMsgs ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground italic py-8">
            Nenhuma mensagem ainda. {isClosed ? "Esta conversa está encerrada." : "Diga olá quando quiser 💛"}
          </p>
        ) : (
          rows.map((r, idx) => {
            if (r.kind === "day") {
              return (
                <div key={r.key} className="flex justify-center my-3">
                  <span className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-card text-muted-foreground shadow-sm border border-border/40">
                    {r.label}
                  </span>
                </div>
              );
            }
            const { msg, mine, isLastOfGroup } = r;
            const prev = rows[idx - 1];
            const tightTop = prev && prev.kind === "msg" && prev.mine === mine;
            const read = !!msg.read_at;
            return (
              <div
                key={r.key}
                className={cn("flex flex-col", mine ? "items-end" : "items-start", tightTop ? "mt-0.5" : "mt-2")}
              >
                <div
                  className={cn(
                    "max-w-[78%] px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm",
                    mine
                      ? "bg-amber-500 text-amber-50 rounded-2xl"
                      : "bg-card text-foreground rounded-2xl",
                    isLastOfGroup && (mine ? "rounded-br-sm" : "rounded-bl-sm"),
                    msg.failed && "ring-1 ring-destructive/60"
                  )}
                >
                  <p>{msg.body}</p>
                  {!mine && Array.isArray(msg.metadata?.ctas) && msg.metadata!.ctas!.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {msg.metadata!.ctas!.map((cta, i) => (
                        <button
                          key={`${cta.kind || "cta"}-${i}`}
                          type="button"
                          onClick={() => navigate(cta.to)}
                          className={cn(
                            "w-full text-sm font-medium rounded-xl px-3 py-2 transition-colors",
                            cta.primary || i === 0
                              ? "bg-amber-500 text-amber-50 hover:bg-amber-600"
                              : "bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100"
                          )}
                        >
                          {cta.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={cn("flex items-center justify-end gap-1 mt-1 text-[10px]", mine ? "text-amber-50/80" : "text-muted-foreground")}>
                    <span>{format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}</span>
                    {mine && !msg.failed && (
                      msg.pending ? (
                        <Clock className="h-3 w-3" />
                      ) : read ? (
                        <CheckCheck className="h-3 w-3 text-sky-200" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )
                    )}
                  </div>
                </div>
                {mine && msg.failed && (
                  <button
                    type="button"
                    onClick={() => msg.outboxActionId && outbox.retry(msg.outboxActionId)}
                    className="mt-1 text-[11px] text-destructive font-medium flex items-center gap-1 hover:underline"
                  >
                    <AlertCircle className="h-3 w-3" /> Não enviada · Toque para reenviar
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {!isOnline && (
        <div className="px-3 py-1.5 bg-amber-50 text-amber-900 text-[11px] text-center flex items-center justify-center gap-1.5 border-t border-amber-200">
          <WifiOff className="h-3 w-3" /> Sem conexão — mensagens serão enviadas ao reconectar
        </div>
      )}

      {/* Composer */}
      <div className="chat-input bg-card px-2 py-2 shrink-0 border-t border-border/40">
        {isClosed ? (
          <p className="text-xs text-center text-muted-foreground italic py-2">
            Conversa encerrada — você não pode mais enviar mensagens.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Mensagem"
              maxLength={2000}
              rows={1}
              lang="pt-BR"
              inputMode="text"
              enterKeyHint="send"
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              autoComplete="off"
              name="chat-message"
              className="min-h-[42px] resize-none flex-1 rounded-3xl bg-muted/70 border-0 px-4 py-2.5 focus-visible:ring-1 text-[16px]"
            />
            <Button
              size="icon"
              className="bg-amber-500 hover:bg-amber-600 text-amber-50 shrink-0 rounded-full h-11 w-11 shadow-md transition-transform active:scale-95"
              onClick={handleSend}
              disabled={!draft.trim() || send.isPending}
            >
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
