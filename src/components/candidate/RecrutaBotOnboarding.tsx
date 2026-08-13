import { useState } from "react";
import { MessageCircle, Send, X, Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const WELCOME = "Olá! Sou o RecrutaBot 🤖 Posso te ajudar com dúvidas sobre o onboarding. Pergunte sobre termos, dados ou senha!";

export function RecrutaBotOnboarding() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: WELCOME }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    const updated = [...messages, { role: "user" as const, content: q }];
    setMessages(updated);
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("faq-assistant", {
        body: { question: q, scope: "onboarding" },
      });
      setMessages([...updated, { role: "assistant", content: data?.answer || "Não encontrei orientação sobre isso. Tente reformular." }]);
    } catch {
      setMessages([...updated, { role: "assistant", content: "Erro ao consultar. Tente novamente." }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-xs text-primary gap-1"
        onClick={() => setOpen(true)}
      >
        <Bot className="h-3.5 w-3.5" />
        Precisa de ajuda? Pergunte ao RecrutaBot
      </Button>
    );
  }

  return (
    <Card className="border border-primary/20 shadow-sm mt-2">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Bot className="h-3.5 w-3.5" />
            RecrutaBot
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="max-h-40 overflow-y-auto space-y-1.5 text-xs">
          {messages.map((m, i) => (
            <div key={i} className={`rounded-lg px-2.5 py-1.5 ${m.role === "assistant" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-foreground ml-4"}`}>
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-1 text-muted-foreground px-2.5 py-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Pensando...
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <input
            className="flex-1 text-xs border rounded-md px-2 py-1.5 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Ex: O que são os termos?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={loading}
          />
          <Button size="icon" className="h-7 w-7 shrink-0" onClick={send} disabled={loading || !input.trim()}>
            <Send className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
