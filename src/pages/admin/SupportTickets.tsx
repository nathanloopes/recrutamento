import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Bot, User, Clock, CheckCircle2, Send, Loader2, BookOpen, AlertTriangle } from "lucide-react";
import { useAllSupportTickets, useRespondTicket, useGenerateFAQFromTicket, FAQSuggestion } from "@/hooks/useSupportTickets";
import { useCreateArticle } from "@/hooks/useFAQ";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const statusOptions = [
  { value: "todos", label: "Todos" },
  { value: "aberto", label: "Abertos" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "resolvido_ia", label: "Resolvido IA" },
  { value: "fechado", label: "Fechados" },
];

const statusBadge: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  resolvido_ia: { variant: "secondary", label: "Resolvido IA" },
  aberto: { variant: "destructive", label: "Aberto" },
  em_atendimento: { variant: "default", label: "Em atendimento" },
  fechado: { variant: "outline", label: "Fechado" },
};

const TAG_OPTIONS = ["recrutamento", "geral", "entrevista", "documentação", "onboarding"];

export default function SupportTickets() {
  const [statusFilter, setStatusFilter] = useState("aberto");
  const { data: tickets, isLoading } = useAllSupportTickets(statusFilter);
  const respondTicket = useRespondTicket();
  const generateFAQ = useGenerateFAQFromTicket();
  const createArticle = useCreateArticle();
  const { user } = useAuth();
  const { toast } = useToast();

  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [response, setResponse] = useState("");

  // FAQ generation state
  const [faqDialogOpen, setFaqDialogOpen] = useState(false);
  const [faqTicketId, setFaqTicketId] = useState<string | null>(null);
  const [faqSuggestion, setFaqSuggestion] = useState<FAQSuggestion | null>(null);
  const [faqQuestion, setFaqQuestion] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");
  const [faqTags, setFaqTags] = useState<string[]>([]);

  const handleRespond = async () => {
    if (!selectedTicket || !response.trim() || !user) return;
    await respondTicket.mutateAsync({
      ticketId: selectedTicket.id,
      response: response.trim(),
      adminId: user.id,
    });
    setSelectedTicket(null);
    setResponse("");
  };

  const handleGenerateFAQ = async (ticketId: string) => {
    setFaqTicketId(ticketId);
    setFaqDialogOpen(true);
    setFaqSuggestion(null);
    const result = await generateFAQ.mutateAsync(ticketId);
    setFaqSuggestion(result);
    setFaqQuestion(result.suggested_question);
    setFaqAnswer(result.suggested_answer);
    setFaqTags(result.suggested_tags);
  };

  const handlePublishFAQ = async () => {
    if (!faqQuestion.trim() || !faqAnswer.trim()) return;
    await createArticle.mutateAsync({
      question: faqQuestion.trim(),
      answer: faqAnswer.trim(),
      tags: faqTags,
      status: "publicado",
    });
    toast({ title: "Artigo publicado no FAQ com sucesso!" });
    setFaqDialogOpen(false);
    setFaqSuggestion(null);
  };

  const toggleTag = (tag: string) => {
    setFaqTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Chamados de Suporte</h1>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !tickets?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Nenhum chamado encontrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const badge = statusBadge[ticket.status] || statusBadge.aberto;
            return (
              <Card key={ticket.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        <p className="text-sm font-medium">{ticket.question}</p>
                      </div>

                      {ticket.ai_answer && (
                        <div className="flex items-start gap-2 p-2 bg-primary/5 rounded text-xs">
                          <Bot className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium">IA ({Math.round(ticket.ai_confidence * 100)}%):</span>{" "}
                            <span className="text-muted-foreground line-clamp-2">{ticket.ai_answer}</span>
                          </div>
                        </div>
                      )}

                      {ticket.context && Object.keys(ticket.context).length > 0 && (
                        <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                          <span className="font-medium">Contexto:</span>{" "}
                          {(ticket.context as any).extra_info || JSON.stringify(ticket.context)}
                        </div>
                      )}

                      {ticket.admin_response && (
                        <div className="text-xs p-2 bg-green-50 rounded border border-green-200">
                          <span className="font-medium text-green-700">Resposta admin:</span>{" "}
                          {ticket.admin_response}
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(ticket.created_at).toLocaleString("pt-BR")}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {(ticket.status === "aberto" || ticket.status === "em_atendimento") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedTicket(ticket);
                            setResponse("");
                          }}
                        >
                          Responder
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs"
                        onClick={() => handleGenerateFAQ(ticket.id)}
                        disabled={generateFAQ.isPending && faqTicketId === ticket.id}
                      >
                        {generateFAQ.isPending && faqTicketId === ticket.id ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <BookOpen className="h-3 w-3 mr-1" />
                        )}
                        Transformar em FAQ
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Respond Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Responder Chamado</DialogTitle>
            <DialogDescription>Responda ao candidato e feche o chamado.</DialogDescription>
          </DialogHeader>
          {selectedTicket && (
            <div className="space-y-3">
              <div className="p-3 bg-muted/50 rounded text-sm">
                <p className="font-medium mb-1">Pergunta:</p>
                <p>{selectedTicket.question}</p>
              </div>
              {selectedTicket.ai_answer && (
                <div className="p-3 bg-primary/5 rounded text-sm">
                  <p className="font-medium mb-1 flex items-center gap-1">
                    <Bot className="h-4 w-4" /> Resposta da IA ({Math.round(selectedTicket.ai_confidence * 100)}%):
                  </p>
                  <p className="text-muted-foreground">{selectedTicket.ai_answer}</p>
                </div>
              )}
              <Textarea
                placeholder="Digite sua resposta..."
                rows={4}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTicket(null)}>
              Cancelar
            </Button>
            <Button onClick={handleRespond} disabled={!response.trim() || respondTicket.isPending}>
              {respondTicket.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Enviar e Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FAQ Generation Dialog */}
      <Dialog open={faqDialogOpen} onOpenChange={(open) => !open && setFaqDialogOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Transformar em FAQ
            </DialogTitle>
            <DialogDescription>Revise a sugestão da IA antes de publicar no FAQ.</DialogDescription>
          </DialogHeader>

          {generateFAQ.isPending ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Gerando sugestão com IA...</p>
            </div>
          ) : faqSuggestion ? (
            <div className="space-y-4">
              {faqSuggestion.is_duplicate && faqSuggestion.similar_articles.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-800">Possível duplicata detectada</p>
                    <ul className="mt-1 text-yellow-700 text-xs space-y-1">
                      {faqSuggestion.similar_articles.map((a) => (
                        <li key={a.id}>• {a.question}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-yellow-600">
                      Considere atualizar o artigo existente em vez de criar um novo.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-1 block">Pergunta</label>
                <Input value={faqQuestion} onChange={(e) => setFaqQuestion(e.target.value)} />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Resposta</label>
                <Textarea rows={5} value={faqAnswer} onChange={(e) => setFaqAnswer(e.target.value)} />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {TAG_OPTIONS.map((tag) => (
                    <Badge
                      key={tag}
                      variant={faqTags.includes(tag) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setFaqDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handlePublishFAQ}
              disabled={!faqSuggestion || !faqQuestion.trim() || !faqAnswer.trim() || createArticle.isPending}
            >
              {createArticle.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4 mr-1" />
              )}
              Publicar no FAQ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
