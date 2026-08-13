import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Send, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

interface WhatsAppMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName: string;
  eventType: string;
  defaultTitle: string;
  defaultBody: string;
  onConfirm: (title: string, body: string) => void;
}

export function WhatsAppMessageDialog({
  open,
  onOpenChange,
  candidateName,
  eventType,
  defaultTitle,
  defaultBody,
  onConfirm,
}: WhatsAppMessageDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState(defaultBody);
  const [reformulating, setReformulating] = useState(false);
  const [sending, setSending] = useState(false);

  const handleReformulate = async () => {
    setReformulating(true);
    try {
      const { data, error } = await supabase.functions.invoke("reformulate-faq-response", {
        body: {
          question: `Mensagem WhatsApp para candidato sobre: ${eventType}`,
          draft_response: `${title}\n\n${body}`,
        },
      });

      if (error) throw error;

      const reformulated = data?.reformulated as string;
      if (reformulated) {
        const lines = reformulated.split("\n");
        const newTitle = lines[0]?.replace(/^\*+|\*+$/g, "").trim() || title;
        const newBody = lines.slice(1).join("\n").trim() || reformulated;
        setTitle(newTitle);
        setBody(newBody);
        toast.success("Mensagem reformulada com IA");
      }
    } catch (e) {
      console.error("Reformulation error:", e);
      toast.error("Erro ao reformular com IA");
    } finally {
      setReformulating(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await onConfirm(title, body);
      onOpenChange(false);
    } catch (err: any) {
      const raw = String(err?.message || err?.details || err || "");
      const minScoreMatch = raw.match(/MIN_SCORE_NOT_MET:\s*score\s*([\d.,]+)\s*menor que min_score\s*([\d.,]+)/i);
      if (minScoreMatch) {
        const score = minScoreMatch[1];
        const min = minScoreMatch[2];
        toast.error(
          `Score do candidato (${score}) está abaixo do mínimo exigido pelo cargo (${min}). Não é possível aprovar.`
        );
      } else {
        toast.error(raw || "Erro ao enviar mensagem");
      }
      // Mantém o diálogo aberto para o recrutador decidir o próximo passo
    } finally {
      setSending(false);
    }
  };

  // Reset fields when dialog opens with new defaults
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setTitle(defaultTitle);
      setBody(defaultBody);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-green-600" />
            Mensagem WhatsApp
          </DialogTitle>
          <DialogDescription>
            Personalize a mensagem para <strong>{candidateName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">Título</label>
            <input
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">Mensagem</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Escreva a mensagem..."
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground mb-1">Pré-visualização:</p>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{body}</p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleReformulate}
            disabled={reformulating || !body.trim()}
            className="w-full sm:w-auto"
          >
            {reformulating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1" />
            )}
            Reformular com IA
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="w-full sm:w-auto"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Send className="h-4 w-4 mr-1" />
            )}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
