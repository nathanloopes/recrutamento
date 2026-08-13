import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ThumbsUp, ThumbsDown, Search, HelpCircle, Bot, Send, Loader2, MessageSquare, Clock, CheckCircle2, Mic, MicOff, Volume2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublishedFAQ, useSubmitFeedback, useLogFAQQuery, useMyFAQQuestions, useMyUnreadAnswersCount, useMarkAnswersRead } from "@/hooks/useFAQ";
import { useAskFAQAssistant } from "@/hooks/useSupportTickets";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { PageHelp } from "@/components/ui/page-help";
import { supabase, SUPABASE_URL as SUPABASE_URL_TTS, SUPABASE_ANON_KEY as SUPABASE_ANON_KEY_TTS } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TAGS = ["recrutamento", "entrevista", "documentacao", "onboarding", "geral"];

// ─── Module-level TTS prefetch cache ────────────────────────────────────────

const ttsCache = new Map<string, Promise<string | null>>();
const ttsResolved = new Map<string, string>(); // key -> blob URL

function ttsHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return h.toString(36);
}

function prefetchAnswerAudio(text: string): Promise<string | null> {
  const trimmed = (text || "").substring(0, 4096);
  if (!trimmed) return Promise.resolve(null);
  const key = ttsHash(trimmed);
  if (ttsResolved.has(key)) return Promise.resolve(ttsResolved.get(key)!);
  const existing = ttsCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || SUPABASE_ANON_KEY_TTS;
      const response = await fetch(`${SUPABASE_URL_TTS}/functions/v1/tts-openai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY_TTS,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: trimmed, voice: "nova", speed: 1.0 }),
      });
      if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob || blob.size === 0) throw new Error("Empty audio blob");
      const url = URL.createObjectURL(blob);
      ttsResolved.set(key, url);

      // Bound cache to ~20 entries
      if (ttsResolved.size > 20) {
        const firstKey = ttsResolved.keys().next().value;
        if (firstKey) {
          const oldUrl = ttsResolved.get(firstKey);
          if (oldUrl) URL.revokeObjectURL(oldUrl);
          ttsResolved.delete(firstKey);
        }
      }
      return url;
    } catch (err) {
      console.error("[FAQ TTS] prefetch failed", err);
      return null;
    } finally {
      ttsCache.delete(key);
    }
  })();

  ttsCache.set(key, promise);
  return promise;
}

function useSearchDebounce(value: string, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function CandidateFAQ() {
  const location = useLocation();
  const initialTab = location.state?.activeTab || "faq";
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | undefined>();
  const debouncedSearch = useSearchDebounce(search);
  const { data: articles, isLoading } = usePublishedFAQ(debouncedSearch, activeTag);
  const submitFeedback = useSubmitFeedback();
  const logQuery = useLogFAQQuery();
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, boolean>>({});
  const [negComment, setNegComment] = useState<Record<string, string>>({});
  const [showComment, setShowComment] = useState<Record<string, boolean>>({});
  const [aiFeedbackGiven, setAiFeedbackGiven] = useState(false);

  // AI Assistant state
  const [aiQuestion, setAiQuestion] = useState("");
  const askAssistant = useAskFAQAssistant();
  const [aiResult, setAiResult] = useState<{
    answer: string;
    confidence: number;
    resolved: boolean;
    related_articles: { id: string; question: string; answer: string }[];
  } | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioPreparing, setAudioPreparing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Get/create persistent audio element with preload
  const getAudioEl = (): HTMLAudioElement => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      a.onended = () => setIsSpeaking(false);
      a.onerror = () => {
        console.error("[FAQ TTS] audio element error");
        setIsSpeaking(false);
      };
      audioRef.current = a;
    }
    return audioRef.current;
  };

  const playWithSpeechSynthesis = (text: string): boolean => {
    if (!("speechSynthesis" in window)) return false;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.substring(0, 4096));
      utterance.lang = "pt-BR";
      utterance.rate = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const ptVoice = voices.find(v => v.lang.startsWith("pt"));
      if (ptVoice) utterance.voice = ptVoice;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = (e) => {
        console.error("[FAQ TTS] speechSynthesis error", e);
        setIsSpeaking(false);
        toast.error("Erro ao reproduzir áudio");
      };
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (e) {
      console.error("[FAQ TTS] speechSynthesis threw", e);
      return false;
    }
  };

  const handleListenResponse = async (text: string) => {
    // Toggle: stop if already playing
    if (isSpeaking) {
      try { audioRef.current?.pause(); } catch { /* noop */ }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);

    // Prime audio element synchronously (within user gesture) to satisfy autoplay policy.
    const audio = getAudioEl();

    try {
      // Hits cache if prefetch already done; otherwise awaits in-flight fetch.
      const url = await prefetchAnswerAudio(text);
      if (!url) throw new Error("TTS unavailable");

      audio.src = url;
      try {
        await audio.play();
      } catch (playErr) {
        console.error("[FAQ TTS] audio.play() rejected", playErr);
        if (!playWithSpeechSynthesis(text)) {
          setIsSpeaking(false);
          toast.error("Não foi possível reproduzir o áudio");
        }
      }
    } catch (err) {
      console.error("[FAQ TTS] falling back to speechSynthesis", err);
      if (!playWithSpeechSynthesis(text)) {
        setIsSpeaking(false);
        toast.error("Não foi possível reproduzir o áudio");
      }
    }
  };

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        await transcribeAudio(blob);
      };
      mediaRecorderRef.current = recorder;
      chunksRef.current = chunks;
      recorder.start();
      setIsRecording(true);
    } catch {
      toast.error("Não foi possível acessar o microfone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const fileName = `faq-voice-${Date.now()}.webm`;
      const { error: uploadErr } = await supabase.storage
        .from("voice-recordings")
        .upload(fileName, blob, { contentType: "audio/webm" });
      if (uploadErr) throw uploadErr;

      const { data: signedUrl } = await supabase.storage
        .from("voice-recordings")
        .createSignedUrl(fileName, 300);
      if (!signedUrl?.signedUrl) throw new Error("Failed to get signed URL");

      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: { audio_url: signedUrl.signedUrl },
      });
      if (error) throw error;

      const text = data?.text || data?.transcription || "";
      if (text) {
        setAiQuestion(text);
        toast.success("Áudio transcrito!");
      } else {
        toast.error("Não foi possível transcrever o áudio.");
      }

      // Clean up
      await supabase.storage.from("voice-recordings").remove([fileName]);
    } catch (err: any) {
      toast.error(err.message || "Erro na transcrição");
    } finally {
      setIsTranscribing(false);
    }
  };

  // My questions
  const { data: myQuestions } = useMyFAQQuestions();
  const { data: unreadCount } = useMyUnreadAnswersCount();
  const markRead = useMarkAnswersRead();

  // CrossConfig FAQ settings
  const { data: faqSettings } = useGlobalSettings("faq");
  const faqAiEnabled = faqSettings?.find(s => s.key === "faq_ai_enabled")?.value !== false;
  const allowVoice = faqSettings?.find(s => s.key === "allow_voice")?.value !== false;
  // Item 13: feedback_required
  const feedbackRequired = faqSettings?.find(s => s.key === "feedback_required")?.value === true || faqSettings?.find(s => s.key === "feedback_required")?.value === "true";
  // Item 14: domains_enabled
  const domainsEnabled = faqSettings?.find(s => s.key === "domains_enabled")?.value;
  const activeDomains: string[] = Array.isArray(domainsEnabled) ? domainsEnabled.map(String) : [];

  // Log search
  const [lastLogged, setLastLogged] = useState("");
  useEffect(() => {
    if (!debouncedSearch.trim() || isLoading || debouncedSearch === lastLogged) return;
    const ids = (articles ?? []).map((a) => a.id);
    logQuery.mutate({
      question: debouncedSearch,
      matched_article_ids: ids,
      answer: ids.length ? "Artigos encontrados" : null,
      confidence: ids.length ? 0.5 : 0,
    });
    setLastLogged(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, isLoading]);

  // Prefetch TTS audio in background as soon as AI answer arrives.
  useEffect(() => {
    if (!aiResult?.answer || !allowVoice) {
      setAudioReady(false);
      setAudioPreparing(false);
      return;
    }
    setAudioReady(false);
    setAudioPreparing(true);
    let cancelled = false;
    prefetchAnswerAudio(aiResult.answer).then((url) => {
      if (cancelled) return;
      setAudioPreparing(false);
      setAudioReady(!!url);
    });
    return () => { cancelled = true; };
  }, [aiResult?.answer, allowVoice]);

  // Stop audio + cleanup on unmount
  useEffect(() => {
    return () => {
      try { audioRef.current?.pause(); } catch { /* noop */ }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const handleFeedback = (articleId: string, helpful: boolean) => {
    if (feedbackGiven[articleId]) return;
    if (!helpful) {
      setShowComment((p) => ({ ...p, [articleId]: true }));
      return;
    }
    submitFeedback.mutate({ faq_article_id: articleId, helpful });
    setFeedbackGiven((p) => ({ ...p, [articleId]: true }));
  };

  const sendNegativeFeedback = (articleId: string) => {
    submitFeedback.mutate({ faq_article_id: articleId, helpful: false, comment: negComment[articleId] });
    setFeedbackGiven((p) => ({ ...p, [articleId]: true }));
    setShowComment((p) => ({ ...p, [articleId]: false }));
  };

  const handleAskAI = async () => {
    if (!aiQuestion.trim() || askAssistant.isPending) return;
    // Item 13: Block new AI question if feedback is required and last answer not evaluated
    if (feedbackRequired && aiResult && !aiFeedbackGiven) {
      toast.info("Avalie a resposta anterior antes de fazer outra pergunta.");
      return;
    }
    setAiResult(null);
    setAiFeedbackGiven(false);
    try {
      const result = await askAssistant.mutateAsync(aiQuestion.trim());
      setAiResult(result);
    } catch {
      // Error already handled by mutation onError toast
    }
  };

  // Lista combinada (ordenada por created_at desc — já vem assim do hook), excluindo arquivadas
  const visibleQuestions = (myQuestions ?? []).filter((q) => q.status !== "arquivado");
  const getGroup = (q: typeof visibleQuestions[number]): "admin" | "ia" | "pendente" => {
    if (q.admin_response) return "admin";
    if (q.status === "resolvido_ia") return "ia";
    return "pendente";
  };

  const handleTabChange = (value: string) => {
    if (value === "minhas" && unreadCount && unreadCount > 0) {
      markRead.mutate();
    }
  };

  return (
    <div className="px-4 pt-6 pb-24 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">Central de Dúvidas</h1>
        </div>
        <PageHelp />
      </div>

      <Tabs defaultValue={initialTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="minhas" className="relative">
            Minhas Perguntas
            {!!unreadCount && unreadCount > 0 && (
              <Badge className="ml-1.5 bg-destructive text-destructive-foreground text-[10px] h-5 min-w-5 flex items-center justify-center rounded-full px-1.5">
                {unreadCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-6 mt-4">
          {/* FAQ Search - moved above RecrutaBot */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="Buscar nos artigos do FAQ..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {TAGS.map((t) => (
                <Badge
                  key={t}
                  variant={activeTag === t ? "default" : "outline"}
                  className="cursor-pointer capitalize"
                  onClick={() => setActiveTag(activeTag === t ? undefined : t)}
                >
                  {t}
                </Badge>
              ))}
            </div>

            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : !articles?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                <HelpCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum artigo encontrado.</p>
              </div>
            ) : (
              <Accordion type="single" collapsible className="space-y-2">
                {articles.map((a) => (
                  <AccordionItem key={a.id} value={a.id} className="border rounded-lg px-4">
                    <AccordionTrigger className="text-sm font-medium text-left">
                      {a.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {a.answer}
                      {!feedbackGiven[a.id] && (
                        <div className="mt-4 pt-3 border-t space-y-2">
                          <p className="text-xs text-muted-foreground">Esta resposta foi útil?</p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleFeedback(a.id, true)}>
                              <ThumbsUp className="h-3 w-3 mr-1" />Sim
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleFeedback(a.id, false)}>
                              <ThumbsDown className="h-3 w-3 mr-1" />Não
                            </Button>
                          </div>
                          {showComment[a.id] && (
                            <div className="space-y-2">
                              <Textarea
                                placeholder="O que poderia melhorar? (opcional)"
                                rows={2}
                                value={negComment[a.id] ?? ""}
                                onChange={(e) => setNegComment((p) => ({ ...p, [a.id]: e.target.value }))}
                              />
                              <Button size="sm" onClick={() => sendNegativeFeedback(a.id)}>Enviar</Button>
                            </div>
                          )}
                        </div>
                      )}
                      {feedbackGiven[a.id] && (
                        <p className="mt-3 text-xs text-green-600">Obrigado pelo feedback!</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>

          {/* AI Assistant Section */}
          {faqAiEnabled && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Pergunte ao RecrutaBot
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                A IA tentará resolver sua dúvida. Se não conseguir, encaminharemos para o admin.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Digite ou fale sua dúvida..."
                  value={aiQuestion}
                  onChange={(e) => setAiQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAskAI()}
                  disabled={askAssistant.isPending || isTranscribing}
                />
                {allowVoice && (
                <Button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={askAssistant.isPending || isTranscribing}
                  size="icon"
                  variant={isRecording ? "destructive" : "outline"}
                  title={isRecording ? "Parar gravação" : "Gravar pergunta por voz"}
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isRecording ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>
                )}
                <Button
                  onClick={handleAskAI}
                  disabled={!aiQuestion.trim() || askAssistant.isPending}
                  size="icon"
                >
                  {askAssistant.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {isRecording && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <Mic className="h-4 w-4 animate-pulse" />
                  Gravando... Clique no botão para parar.
                </div>
              )}

              {askAssistant.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analisando sua dúvida...
                </div>
              )}

              {aiResult && (
                <Card className="bg-background">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <Bot className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                      <p className="text-sm whitespace-pre-wrap">{aiResult.answer}</p>
                    </div>
                    {allowVoice && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleListenResponse(aiResult.answer)}
                        className="gap-1"
                      >
                        {audioPreparing && !isSpeaking ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Volume2 className={`h-3 w-3 ${isSpeaking ? "animate-pulse text-primary" : ""}`} />
                        )}
                        {isSpeaking ? "Parar" : audioPreparing ? "Preparando áudio…" : "Ouvir resposta"}
                      </Button>
                    )}

                    {aiResult.related_articles.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Artigos relacionados:</p>
                        {aiResult.related_articles.map((art) => (
                          <div key={art.id} className="text-xs bg-muted/50 p-2 rounded">
                            <span className="font-medium">{art.question}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {aiResult.resolved ? (
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600"
                          onClick={() => { setAiFeedbackGiven(true); setAiResult(null); setAiQuestion(""); }}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Resolveu minha dúvida
                        </Button>
                      </div>
                    ) : (
                      <div className="pt-2">
                        <p className="text-xs text-muted-foreground">
                          Não encontrei uma resposta completa. Sua dúvida foi encaminhada e você receberá uma resposta em breve.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
          )}
        </TabsContent>

        {/* Minhas Perguntas Tab */}
        <TabsContent value="minhas" className="space-y-4 mt-4">
          {!myQuestions?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Você ainda não fez nenhuma pergunta.</p>
              <p className="text-xs mt-1">Use o RecrutaBot na aba FAQ para enviar sua dúvida.</p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="space-y-2">
              {visibleQuestions.map((q) => {
                const group = getGroup(q);
                const isNew = group === "admin" && !q.read_at;
                return (
                  <AccordionItem
                    key={q.id}
                    value={q.id}
                    className={`border rounded-lg px-4 ${isNew ? "border-primary/40 bg-primary/5" : ""}`}
                  >
                    <AccordionTrigger className="text-sm font-medium text-left">
                      <div className="flex items-center gap-2 flex-1 mr-2">
                        <span>{q.question}</span>
                        {isNew && (
                          <Badge className="bg-destructive text-destructive-foreground text-[10px] shrink-0">Nova</Badge>
                        )}
                        {group === "admin" && (
                          <Badge variant="outline" className="text-green-600 border-green-300 shrink-0 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-1" />Respondida pelo admin
                          </Badge>
                        )}
                        {group === "ia" && (
                          <Badge variant="outline" className="text-sky-600 border-sky-300 shrink-0 text-[10px]">
                            <Bot className="h-3 w-3 mr-1" />Respondida pelo RecrutaBot
                          </Badge>
                        )}
                        {group === "pendente" && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 shrink-0 text-[10px]">
                            <Clock className="h-3 w-3 mr-1" />Pendente
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground space-y-3">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="font-medium">Enviada em:</span>
                        {new Date(q.created_at).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })}
                      </div>
                      {group === "admin" && (
                        <div>
                          <p className="text-xs font-medium text-foreground mb-1">Resposta do administrador:</p>
                          <div className="p-3 bg-muted/50 rounded-lg text-sm">
                            {q.admin_response}
                          </div>
                        </div>
                      )}
                      {group === "ia" && (
                        <div>
                          <p className="text-xs font-medium text-foreground mb-1 flex items-center gap-1">
                            <Bot className="h-3 w-3" />Resposta do RecrutaBot:
                          </p>
                          <div className="p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap">
                            {q.answer || "Sem conteúdo."}
                          </div>
                        </div>
                      )}
                      {group === "pendente" && (
                        <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground italic">
                          Aguardando resposta do administrador...
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </TabsContent>
      </Tabs>

    </div>
  );
}
