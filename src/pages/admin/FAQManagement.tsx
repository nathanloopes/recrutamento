import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, Archive, Pencil, FileQuestion, ThumbsUp, AlertTriangle, Send, MessageSquare, Sparkles, Loader2, RotateCcw, CheckCircle2, ChevronDown, ChevronUp, Eye, Trash2, Search, HelpCircle, User, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useFAQArticles,
  useCreateArticle,
  useUpdateArticle,
  useArchiveArticle,
  useFAQFeedbacks,
  useFAQLogs,
  useUnansweredQuestions,
  useAnsweredQuestions,
  useRespondToQuestion,
  useResetQuestion,
  useDeleteQuestion,
  usePublishedFAQ,
  useAdminNames,
  type FAQArticle,
} from "@/hooks/useFAQ";
import { PageHelp } from "@/components/ui/page-help";
import { useAuth } from "@/contexts/AuthContext";
import { formatRelativeDateTimeBR } from "@/lib/dateUtils";

const ALL_TAGS = ["recrutamento", "entrevista", "documentacao", "onboarding", "geral"];

function RelatedQuestionsDialog({ article, open, onOpenChange }: { article: FAQArticle | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Array<{ source: string; question: string; created_at: string }>>([]);

  useEffect(() => {
    if (!open || !article) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setItems([]);
      try {
        const [logs, tickets] = await Promise.all([
          supabase.from("faq_ai_logs").select("question, created_at").contains("matched_article_ids", [article.id]).order("created_at", { ascending: false }).limit(200),
          supabase.from("support_tickets").select("question, created_at").contains("matched_article_ids", [article.id]).order("created_at", { ascending: false }).limit(200),
        ]);
        if (cancelled) return;
        const merged: Array<{ source: string; question: string; created_at: string }> = [];
        (logs.data ?? []).forEach((r: any) => merged.push({ source: "IA", question: r.question, created_at: r.created_at }));
        (tickets.data ?? []).forEach((r: any) => merged.push({ source: "Chamado", question: r.question, created_at: r.created_at }));
        const seen = new Set<string>();
        const unique = merged.filter((m) => {
          const k = (m.question ?? "").trim().toLowerCase();
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        unique.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        setItems(unique);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, article?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Perguntas agrupadas neste artigo</DialogTitle>
        </DialogHeader>
        {article && (
          <div className="space-y-3">
            <div className="rounded-md border p-3 bg-muted/40">
              <p className="text-xs text-muted-foreground mb-1">Artigo</p>
              <p className="text-sm font-medium whitespace-pre-wrap break-words">{article.question}</p>
            </div>
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhuma pergunta de candidatos foi associada a este artigo ainda.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{items.length} pergunta(s) associada(s)</p>
                <ul className="space-y-2">
                  {items.map((it, idx) => (
                    <li key={idx} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px]">{it.source}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(it.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words">{it.question}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

async function reformulateWithAI(question: string, draft: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("reformulate-faq-response", {
    body: { question, draft_response: draft },
  });
  if (error) throw new Error(error.message ?? "Erro ao reformular");
  if (data?.error) throw new Error(data.error);
  return data.reformulated;
}

function ArticleDialog({ article, onClose, defaultQuestion }: { article?: FAQArticle; onClose: () => void; defaultQuestion?: string }) {
  const create = useCreateArticle();
  const update = useUpdateArticle();
  const [question, setQuestion] = useState(article?.question ?? defaultQuestion ?? "");
  const [answer, setAnswer] = useState(article?.answer ?? "");
  const [tags, setTags] = useState<string[]>(article?.tags ?? []);
  const [status, setStatus] = useState(article?.status ?? (defaultQuestion ? "publicado" : "rascunho"));
  const [reformulating, setReformulating] = useState(false);

  const handleReformulate = async () => {
    if (!question.trim() || !answer.trim()) return;
    setReformulating(true);
    try {
      const result = await reformulateWithAI(question, answer);
      setAnswer(result);
      toast.success("Resposta reformulada pela IA");
    } catch (e: any) {
      toast.error(e.message || "Erro ao reformular");
    } finally {
      setReformulating(false);
    }
  };

  const handleSave = () => {
    if (!question.trim() || !answer.trim()) return;
    if (article) {
      update.mutate({ id: article.id, question, answer, tags, status }, { onSuccess: onClose });
    } else {
      create.mutate({ question, answer, tags, status }, { onSuccess: onClose });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Pergunta</label>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex: Como funciona o processo seletivo?" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium">Resposta</label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleReformulate}
            disabled={reformulating || !answer.trim()}
          >
            {reformulating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            Reformular com IA
          </Button>
        </div>
        <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={6} placeholder="Resposta institucional..." />
      </div>
      <div>
        <label className="text-sm font-medium">Tags</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {ALL_TAGS.map((t) => (
            <Badge
              key={t}
              variant={tags.includes(t) ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
            >
              {t}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Status</label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="rascunho">Rascunho</SelectItem>
            <SelectItem value="publicado">Publicado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleSave} disabled={create.isPending || update.isPending} className="w-full">
        {article ? "Salvar alterações" : "Criar artigo"}
      </Button>
    </div>
  );
}

function RespondDialog({ logId, question, onClose }: { logId: string; question: string; onClose: () => void }) {
  const respond = useRespondToQuestion();
  const [response, setResponse] = useState("");
  const [reformulating, setReformulating] = useState(false);

  const handleReformulate = async () => {
    if (!response.trim()) return;
    setReformulating(true);
    try {
      const result = await reformulateWithAI(question, response);
      setResponse(result);
      toast.success("Resposta reformulada pela IA");
    } catch (e: any) {
      toast.error(e.message || "Erro ao reformular");
    } finally {
      setReformulating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-muted/50 p-3 rounded text-sm">
        <span className="font-medium">Pergunta do candidato:</span>
        <p className="mt-1">{question}</p>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium">Sua resposta</label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleReformulate}
            disabled={reformulating || !response.trim()}
          >
            {reformulating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            Reformular com IA
          </Button>
        </div>
        <Textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          rows={4}
          placeholder="Digite a resposta para o candidato..."
        />
      </div>
      <Button
        onClick={() => respond.mutate({ id: logId, admin_response: response }, { onSuccess: onClose })}
        disabled={!response.trim() || respond.isPending}
        className="w-full"
      >
        <Send className="h-4 w-4 mr-2" />
        Enviar resposta
      </Button>
    </div>
  );
}

/**
 * Visão SIMPLES do FAQ Institucional — para franqueado / gestor de recrutamento.
 * Só leitura: busca, filtro por tag e accordion de perguntas/respostas publicadas.
 * A gestão (criar, editar, arquivar, métricas, dúvidas pendentes) fica em
 * FAQAdminView, acessível apenas para admin / rh_franqueadora.
 */
function FAQReaderView() {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | undefined>(undefined);
  const { data: articles, isLoading } = usePublishedFAQ(search, tag);
  // "Quem respondeu": resolve os autores (created_by) para nome.
  const { data: authorNames } = useAdminNames((articles ?? []).map((a) => a.created_by));

  // Só mostra as tags que realmente têm artigo publicado.
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    (articles ?? []).forEach((a) => (a.tags ?? []).forEach((t) => set.add(t)));
    // Fallback: se o filtro por tag já removeu tudo, ainda deixamos o filtro visível
    ALL_TAGS.forEach((t) => {
      if (tag === t) set.add(t);
    });
    return ALL_TAGS.filter((t) => set.has(t));
  }, [articles, tag]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-sky-100 dark:bg-sky-950/40 p-2.5 shrink-0">
          <HelpCircle className="h-5 w-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">FAQ Institucional</h1>
          <p className="text-muted-foreground">
            Encontre respostas sobre recrutamento, entrevistas, documentação e mais.
          </p>
        </div>
        <div className="ml-auto"><PageHelp /></div>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar em perguntas ou respostas..."
          className="pl-9"
        />
      </div>

      {/* Filtro por tag (chips) */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={!tag ? "default" : "outline"}
            className="cursor-pointer capitalize"
            onClick={() => setTag(undefined)}
          >
            Todas
          </Badge>
          {availableTags.map((t) => (
            <Badge
              key={t}
              variant={tag === t ? "default" : "outline"}
              className="cursor-pointer capitalize"
              onClick={() => setTag(tag === t ? undefined : t)}
            >
              {t}
            </Badge>
          ))}
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (articles ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <FileQuestion className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium">Nenhuma pergunta encontrada</p>
            <p className="text-xs text-muted-foreground">
              {search || tag
                ? "Tente outros termos ou remova o filtro."
                : "Ainda não há artigos publicados."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-2 sm:p-4">
            <Accordion type="single" collapsible className="w-full">
              {(articles ?? []).map((a) => (
                <AccordionItem key={a.id} value={a.id}>
                  <AccordionTrigger className="text-left hover:no-underline">
                    <div className="flex flex-col gap-1 min-w-0 flex-1 pr-3">
                      <span className="font-medium text-sm sm:text-base leading-snug">
                        {a.question}
                      </span>
                      {a.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {a.tags.map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px] capitalize">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed pt-1">
                      {a.answer}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3 shrink-0" />
                        {authorNames?.[a.created_by ?? ""] || "Equipe de Recrutamento"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" />
                        {formatRelativeDateTimeBR(a.updated_at || a.created_at)}
                      </span>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function FAQManagement() {
  const { hasRole } = useAuth();
  const canManage = hasRole("admin") || hasRole("rh_franqueadora");
  if (!canManage) return <FAQReaderView />;
  return <FAQAdminView />;
}

function FAQAdminView() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [tagFilter, setTagFilter] = useState<string | undefined>();
  const { data: articles, isLoading } = useFAQArticles({ status: statusFilter, tag: tagFilter });
  const archive = useArchiveArticle();
  const { data: feedbacks } = useFAQFeedbacks();
  const { data: aiLogs } = useFAQLogs();
  const { data: pendingQuestions } = useUnansweredQuestions();
  const { data: answeredQuestions } = useAnsweredQuestions();
  const resetQuestion = useResetQuestion();
  const deleteQuestion = useDeleteQuestion();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editArticle, setEditArticle] = useState<FAQArticle | undefined>();
  const [publishFromLog, setPublishFromLog] = useState<string | undefined>();
  const [respondLog, setRespondLog] = useState<{ id: string; question: string } | undefined>();
  const [expandedAnswered, setExpandedAnswered] = useState<Record<string, boolean>>({});
  const [relatedArticle, setRelatedArticle] = useState<FAQArticle | null>(null);

  const feedbackMap = (feedbacks ?? []).reduce<Record<string, { up: number; down: number }>>((acc, fb) => {
    if (!acc[fb.faq_article_id]) acc[fb.faq_article_id] = { up: 0, down: 0 };
    if (fb.helpful) { acc[fb.faq_article_id].up++; } else { acc[fb.faq_article_id].down++; }
    return acc;
  }, {});

  // Analytics: top questions
  const topQuestions = (() => {
    const counts: Record<string, number> = {};
    (aiLogs ?? []).forEach((l) => {
      const q = l.question.trim().toLowerCase();
      counts[q] = (counts[q] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([question, count]) => ({ question, count }));
  })();

  // Analytics: useful response rate
  const totalFeedbacks = (feedbacks ?? []).length;
  const positiveFeedbacks = (feedbacks ?? []).filter((f) => f.helpful).length;
  const usefulRate = totalFeedbacks > 0 ? Math.round((positiveFeedbacks / totalFeedbacks) * 100) : 0;

  // Analytics: worst-rated articles
  const worstArticles = Object.entries(feedbackMap)
    .filter(([, fb]) => fb.down > 0)
    .sort((a, b) => b[1].down - a[1].down)
    .slice(0, 5)
    .map(([id, fb]) => {
      const art = (articles ?? []).find((a) => a.id === id);
      return { id, question: art?.question ?? "—", up: fb.up, down: fb.down };
    });

  const unanswered = pendingQuestions ?? [];
  const answered = answeredQuestions ?? [];
  const published = (articles ?? []).filter((a) => a.status === "publicado").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FAQ Institucional</h1>
          <p className="text-muted-foreground">Gestão de perguntas frequentes e métricas</p>
        </div>
        <PageHelp />
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditArticle(undefined); setPublishFromLog(undefined); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Novo artigo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editArticle ? "Editar Artigo" : publishFromLog ? "Publicar Dúvida como FAQ" : "Novo Artigo"}</DialogTitle></DialogHeader>
            <ArticleDialog article={editArticle} defaultQuestion={publishFromLog} onClose={() => setDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Respond dialog */}
      <Dialog open={!!respondLog} onOpenChange={(o) => { if (!o) setRespondLog(undefined); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Responder ao Candidato</DialogTitle></DialogHeader>
          {respondLog && (
            <RespondDialog logId={respondLog.id} question={respondLog.question} onClose={() => setRespondLog(undefined)} />
          )}
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="articles">
        <TabsList>
          <TabsTrigger value="articles">Artigos</TabsTrigger>
          <TabsTrigger value="metrics" className="relative">
            Métricas & Lacunas
            {unanswered.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                {unanswered.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="answered" className="relative">
            Respondidas
            {answered.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-green-600 text-white text-[10px] font-bold">
                {answered.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="articles" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select value={statusFilter ?? "all"} onValueChange={(v) => setStatusFilter(v === "all" ? undefined : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="rascunho">Rascunho</SelectItem>
                <SelectItem value="publicado">Publicado</SelectItem>
                <SelectItem value="arquivado">Arquivado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tagFilter ?? "all"} onValueChange={(v) => setTagFilter(v === "all" ? undefined : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {ALL_TAGS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              {/* Mobile: Cards */}
              <div className="md:hidden space-y-3">
                {(articles ?? []).map((a) => (
                  <Card key={a.id}>
                    <CardContent className="p-4 space-y-3">
                      <p className="font-medium text-sm">{a.question}</p>
                      {a.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {a.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-sm">
                        <Badge variant={a.status === "publicado" ? "default" : a.status === "arquivado" ? "outline" : "secondary"}>
                          {a.status}
                        </Badge>
                        <span className="text-muted-foreground">v{a.version}</span>
                        <span>
                          <span className="text-green-600">👍 {feedbackMap[a.id]?.up ?? 0}</span>
                          {" / "}
                          <span className="text-red-500">👎 {feedbackMap[a.id]?.down ?? 0}</span>
                        </span>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setRelatedArticle(a)}>
                          <Eye className="h-3 w-3 mr-1" />Perguntas
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditArticle(a); setDialogOpen(true); }}>
                          <Pencil className="h-3 w-3 mr-1" />Editar
                        </Button>
                        {a.status !== "arquivado" && (
                          <Button size="sm" variant="outline" onClick={() => archive.mutate(a.id)}>
                            <Archive className="h-3 w-3 mr-1" />Arquivar
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Desktop: Table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pergunta</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>v</TableHead>
                      <TableHead>👍/👎</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(articles ?? []).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="max-w-xs truncate">{a.question}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {a.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={a.status === "publicado" ? "default" : a.status === "arquivado" ? "outline" : "secondary"}>
                            {a.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{a.version}</TableCell>
                        <TableCell>
                          <span className="text-green-600">{feedbackMap[a.id]?.up ?? 0}</span>
                          {" / "}
                          <span className="text-red-500">{feedbackMap[a.id]?.down ?? 0}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => { setEditArticle(a); setDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {a.status !== "arquivado" && (
                              <Button size="icon" variant="ghost" onClick={() => archive.mutate(a.id)}>
                                <Archive className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Publicados</CardTitle></CardHeader>
              <CardContent><p className="text-2xl sm:text-3xl font-bold">{published}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Feedbacks positivos</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <ThumbsUp className="h-5 w-5 text-green-600" />
                  <span className="text-2xl sm:text-3xl font-bold">
                    {Object.values(feedbackMap).reduce((s, f) => s + f.up, 0)}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Dúvidas pendentes</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <span className="text-2xl sm:text-3xl font-bold">{unanswered.length}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Analytics: Useful Rate + Top Questions + Worst Articles */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Taxa de resposta útil</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl sm:text-3xl font-bold">{usefulRate}%</p>
                <p className="text-xs text-muted-foreground">{positiveFeedbacks} de {totalFeedbacks} feedbacks</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Top perguntas</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {topQuestions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma pergunta registrada</p>
                ) : topQuestions.slice(0, 5).map((tq, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="truncate max-w-[200px]">{tq.question}</span>
                    <Badge variant="secondary" className="shrink-0 ml-2">{tq.count}x</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Artigos pior avaliados</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {worstArticles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum artigo com avaliação negativa</p>
                ) : worstArticles.map((wa) => (
                  <div key={wa.id} className="flex justify-between text-xs">
                    <span className="truncate max-w-[180px]">{wa.question}</span>
                    <span className="shrink-0 ml-2">👎 {wa.down} / 👍 {wa.up}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {unanswered.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileQuestion className="h-5 w-5" />Dúvidas dos candidatos aguardando resposta</CardTitle></CardHeader>
              <CardContent>
                {/* Mobile: Cards */}
                <div className="md:hidden space-y-2">
                  {unanswered.map((l) => (
                    <div key={l.id} className="border rounded-md p-3 space-y-2">
                      <p className="text-sm whitespace-pre-wrap break-words">{l.question}</p>
                      {l.answer && (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">IA: {l.answer}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleDateString("pt-BR")}</p>
                         <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setRespondLog({ id: l.id, question: l.question })}>
                            <MessageSquare className="h-3 w-3 mr-1" />Responder
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setPublishFromLog(l.question); setDialogOpen(true); }}>
                            <Send className="h-3 w-3 mr-1" />Publicar
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline" className="text-destructive">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Arquivar pergunta?</AlertDialogTitle>
                                <AlertDialogDescription>A pergunta será arquivada e não aparecerá mais nas listas ativas.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteQuestion.mutate(l.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Arquivar</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop: Table */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pergunta</TableHead>
                        <TableHead>Resposta IA</TableHead>
                        <TableHead>Confiança</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unanswered.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="align-top whitespace-pre-wrap break-words min-w-[220px] max-w-[420px]">{l.question}</TableCell>
                          <TableCell className="align-top text-muted-foreground text-sm whitespace-pre-wrap break-words min-w-[260px] max-w-[520px]">
                            {l.answer || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={l.confidence >= 0.7 ? "default" : "secondary"}>
                              {Math.round(l.confidence * 100)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(l.created_at).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => setRespondLog({ id: l.id, question: l.question })}>
                                <MessageSquare className="h-3 w-3 mr-1" />Responder
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setPublishFromLog(l.question); setDialogOpen(true); }}>
                                <Send className="h-3 w-3 mr-1" />Publicar
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="icon" variant="ghost" className="text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Arquivar pergunta?</AlertDialogTitle>
                                    <AlertDialogDescription>A pergunta será arquivada e não aparecerá mais nas listas ativas.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteQuestion.mutate(l.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Arquivar</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="answered" className="space-y-4">
          {answered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma pergunta respondida ainda</p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Perguntas respondidas ({answered.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {answered.map((l) => {
                  const isExpanded = expandedAnswered[l.id] ?? false;
                  return (
                    <div key={l.id} className="border rounded-md p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{l.question}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(l.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedAnswered((prev) => ({ ...prev, [l.id]: !isExpanded }))}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          <span className="ml-1 text-xs">{isExpanded ? "Fechar" : "Ver resposta"}</span>
                        </Button>
                      </div>
                      {isExpanded && (
                        <div className="bg-muted/50 rounded p-3 text-sm whitespace-pre-wrap">
                          <span className="font-medium text-xs text-muted-foreground block mb-1">Resposta do admin:</span>
                          {l.admin_response || "—"}
                        </div>
                      )}
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resetQuestion.mutate(l.id)}
                          disabled={resetQuestion.isPending}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Excluir e reenviar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setPublishFromLog(l.question); setDialogOpen(true); }}
                        >
                          <Send className="h-3 w-3 mr-1" />
                          Publicar no FAQ
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="text-destructive">
                              <Trash2 className="h-3 w-3 mr-1" />Excluir
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Arquivar pergunta?</AlertDialogTitle>
                              <AlertDialogDescription>A pergunta será arquivada e não aparecerá mais nas listas ativas.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteQuestion.mutate(l.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Arquivar</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
