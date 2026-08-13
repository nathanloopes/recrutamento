import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Send, Loader2, Lock, LockOpen, X, Clock, AlertCircle, WifiOff, Sparkles, Bot, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useThread, useThreadMessages, useSendMessage, type ConversationMessage } from "@/hooks/useConversations";
import { useMarkConversationNotificationsRead } from "@/hooks/useNotifications";
import { useConversationOutbox } from "@/hooks/useConversationOutbox";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatChatDayLabel } from "@/lib/dateUtils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { stickToBottomUntilStable } from "@/lib/chatInitialScroll";
import { useKeyboardOpenClass } from "@/lib/useKeyboardOpenClass";
import { useQueryClient } from "@tanstack/react-query";

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; msg: ConversationMessage };

export default function AdminConversation() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from || "/admin/mensagens";
  const { user, hasRole, unitIds } = useAuth();
  const qc = useQueryClient();
  const { data: thread, isLoading: loadingThread } = useThread(threadId);
  const { data: messages, isLoading: loadingMsgs } = useThreadMessages(threadId);
  const send = useSendMessage(threadId);
  const outbox = useConversationOutbox();
  useMarkConversationNotificationsRead(threadId);
  useKeyboardOpenClass();

  // Intercala separadores de dia entre os grupos de mensagens (mesmas mensagens,
  // já ordenadas por created_at asc). Divide o histórico por dia da semana.
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (!messages || messages.length === 0) return out;
    let lastDay: Date | null = null;
    for (const m of messages) {
      const d = new Date(m.created_at);
      if (!lastDay || !isSameDay(lastDay, d)) {
        out.push({ kind: "day", key: `day-${d.toDateString()}`, label: formatChatDayLabel(d) });
        lastDay = d;
      }
      out.push({ kind: "msg", key: m.id, msg: m });
    }
    return out;
  }, [messages]);

  const [draft, setDraft] = useState("");
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);


  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  const isClosed = thread?.status === "closed";
  const canSend = !!thread && !!user && (
    thread.candidate_id === user.id ||
    hasRole("admin") ||
    hasRole("rh_franqueadora") ||
    (Array.isArray(unitIds) && !!thread.unit_id && unitIds.includes(thread.unit_id))
  );

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

  const didInitialScrollRef = useRef(false);
  const stickStopRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    didInitialScrollRef.current = false;
    stickStopRef.current?.();
    stickStopRef.current = null;
  }, [threadId]);

  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return;
    if (loadingMsgs || !messages || messages.length === 0) return;
    const el =
      scrollRef.current ||
      (document.querySelector(".chat-messages") as HTMLElement | null);
    if (!el) return;
    didInitialScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    stickStopRef.current = stickToBottomUntilStable(el);
    return () => {
      stickStopRef.current?.();
      stickStopRef.current = null;
    };
  }, [threadId, messages, loadingMsgs]);

  // Mantém no final apenas se já estava no final ao chegarem novas mensagens
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    scrollToBottom();
  }, [messages?.length]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await send.mutateAsync(body);
      setDraft("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e: any) {
      toast({ title: "Não foi possível enviar", description: e.message, variant: "destructive" });
    }
  };

  const handleRewriteAsSara = async () => {
    const body = draft.trim();
    if (!body || rewriting) return;
    setRewriting(true);
    try {
      const { data, error } = await supabase.functions.invoke("sara-rewrite", { body: { draft: body } });
      if (error) throw error;
      const rewritten = (data as any)?.rewritten?.trim();
      if (rewritten) {
        setDraft(rewritten);
        toast({ title: "Reescrito no tom da Sara" });
      } else {
        toast({ title: "Não foi possível reescrever", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro ao reescrever", description: e.message, variant: "destructive" });
    } finally {
      setRewriting(false);
    }
  };

  const aiEnabled = (thread as any)?.ai_enabled !== false;
  const handleToggleAi = async (next: boolean) => {
    if (!threadId) return;
    setTogglingAi(true);
    try {
      const { error } = await supabase
        .from("conversation_threads")
        .update({ ai_enabled: next } as any)
        .eq("id", threadId);
      if (error) throw error;
      qc.setQueryData(["conv-thread", threadId], (prev: any) =>
        prev ? { ...prev, ai_enabled: next } : prev
      );
      toast({ title: next ? "Sara automática ligada" : "Sara automática desligada" });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setTogglingAi(false);
    }
  };


  const handleClose = async () => {
    if (!threadId) return;
    if (!confirm("Encerrar esta conversa? O candidato não poderá mais responder.")) return;
    setClosing(true);
    try {
      const { error } = await supabase
        .from("conversation_threads")
        .update({
          status: "closed",
          closed_by: user?.id ?? null,
          closed_at: new Date().toISOString(),
          close_reason: "manual",
        } as any)
        .eq("id", threadId);
      if (error) throw error;
      qc.setQueryData(["conv-thread", threadId], (prev: any) =>
        prev ? { ...prev, status: "closed" } : prev
      );
      qc.invalidateQueries({ queryKey: ["conv-thread", threadId] });
      qc.invalidateQueries({ queryKey: ["conv-threads"] });
      toast({ title: "Conversa encerrada" });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setClosing(false);
    }
  };

  const handleReopen = async () => {
    if (!threadId) return;
    if (!confirm("Reativar esta conversa?")) return;
    setReopening(true);
    try {
      const { error } = await supabase
        .from("conversation_threads")
        .update({
          status: "open",
          closed_by: null,
          closed_at: null,
          close_reason: null,
        } as any)
        .eq("id", threadId);
      if (error) throw error;
      qc.setQueryData(["conv-thread", threadId], (prev: any) =>
        prev ? { ...prev, status: "open" } : prev
      );
      qc.invalidateQueries({ queryKey: ["conv-thread", threadId] });
      qc.invalidateQueries({ queryKey: ["conv-threads"] });
      toast({ title: "Conversa reativada" });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setReopening(false);
    }
  };

  return (
    <div className="chat-root chat-module bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-card flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate(backTo)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0 text-amber-50 font-semibold text-sm shadow-sm">
          {((thread as any)?.candidateName?.trim()?.[0] || "?").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate text-foreground">
            {(thread as any)?.candidateName || "Candidato"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {(thread?.applications?.unit_jobs?.jobs?.title || "Vaga")}
            {" · "}
            {(thread?.applications?.unit_jobs?.units?.name || "Unidade")}
          </p>
        </div>
        {isClosed ? (
          canSend ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-amber-600 hover:text-amber-700 shrink-0"
              onClick={handleReopen}
              disabled={reopening}
            >
              <LockOpen className="h-4 w-4 mr-1" />
              Reativar
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
              <Lock className="h-3 w-3" /> Encerrada
            </span>
          )
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleClose}
            disabled={closing}
          >
            <X className="h-4 w-4 mr-1" />
            Encerrar
          </Button>
        )}
      </div>

      {/* Banner Sara — visível apenas no admin (Ghost Mode) */}
      <div className="px-4 py-2 border-b border-amber-200/60 bg-amber-50/70 dark:bg-amber-950/20 text-[11px] text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3 shrink-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            O candidato vê tudo como <strong>Sara</strong>. Tom: curto, leve, acolhedor, estilo WhatsApp.
          </span>
        </span>
        {canSend && !isClosed && (
          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
            <span className="text-[11px]">Sara automática</span>
            <Switch checked={aiEnabled} onCheckedChange={handleToggleAi} disabled={togglingAi} />
          </label>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="chat-messages px-4 py-4 space-y-3 bg-muted/20">
        {loadingThread || loadingMsgs ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !messages || messages.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground italic py-8">
            Nenhuma mensagem ainda. {isClosed ? "Esta conversa está encerrada." : "Envie a primeira mensagem ao candidato."}
          </p>
        ) : (
          rows.map((r) => {
            if (r.kind === "day") {
              return (
                <div key={r.key} className="flex justify-center my-3">
                  <span className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-card text-muted-foreground shadow-sm border border-border/40">
                    {r.label}
                  </span>
                </div>
              );
            }
            const m = r.msg;
            const mine = m.sender_id === user?.id;
            const isRecruiter = m.sender_role === "recrutador";
            const isAi = isRecruiter && (m.author_kind === "ai" || m.ai_generated);
            return (
              <div key={r.key} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                {isRecruiter && (
                  <span className={cn(
                    "text-[10px] mb-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full",
                    isAi
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {isAi ? <><Bot className="h-2.5 w-2.5" /> Sara (IA)</> : <><UserIcon className="h-2.5 w-2.5" /> {mine ? "Você" : "Equipe"}</>}
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm",
                    mine ? "bg-amber-500 text-amber-50 rounded-br-sm" : "bg-card text-foreground rounded-bl-sm",
                    isAi && !mine && "ring-1 ring-violet-200 dark:ring-violet-900/50",
                    m.failed && "ring-1 ring-destructive/60"
                  )}
                >
                  <p>{m.body}</p>
                  <div className={cn("flex items-center justify-end gap-1 mt-1 text-[10px] opacity-80", mine ? "text-amber-50/80" : "text-muted-foreground")}>
                    <span>{format(new Date(m.created_at), "HH:mm", { locale: ptBR })}</span>
                    {mine && !m.failed && m.pending && <Clock className="h-3 w-3" />}
                  </div>
                </div>
                {mine && m.failed && (
                  <button
                    type="button"
                    onClick={() => m.outboxActionId && outbox.retry(m.outboxActionId)}
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
      <div className="chat-input border-t bg-card px-3 py-2 shrink-0">
        {isClosed ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <p className="text-xs text-muted-foreground italic">
              Conversa encerrada — você não pode mais enviar mensagens.
            </p>
            {canSend && (
              <Button
                variant="outline"
                size="sm"
                className="text-amber-600 hover:text-amber-700 border-amber-200"
                onClick={handleReopen}
                disabled={reopening}
              >
                {reopening ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <LockOpen className="h-3.5 w-3.5 mr-1" />}
                Reativar conversa
              </Button>
            )}
          </div>
        ) : !canSend ? (
          <p className="text-xs text-center text-muted-foreground italic py-2">
            Modo leitura — você não participa desta conversa.
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
              placeholder="Escreva uma mensagem…"
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
              className="min-h-[40px] resize-none flex-1 text-[16px]"
            />
            <Button
              size="icon"
              variant="outline"
              className="shrink-0 text-violet-600 border-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950/20"
              onClick={handleRewriteAsSara}
              disabled={!draft.trim() || rewriting}
              title="Reescrever no tom da Sara"
            >
              {rewriting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              className="bg-amber-500 hover:bg-amber-600 text-amber-50 shrink-0"
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
