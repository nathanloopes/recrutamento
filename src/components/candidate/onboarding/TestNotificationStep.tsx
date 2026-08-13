import { useState } from "react";
import { Send, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  onConfirmed: () => void;
  onRetry: () => void;
}

export function TestNotificationStep({ onConfirmed, onRetry }: Props) {
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [askingConfirmation, setAskingConfirmation] = useState(false);

  const handleSendTest = async () => {
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-test-notification");
      if (error) throw error;
      setSent(true);
      // Pequeno delay pra dar tempo da push chegar
      setTimeout(() => setAskingConfirmation(true), 2500);
    } catch (e) {
      toast({
        title: "Não consegui enviar o teste",
        description: e instanceof Error ? e.message : "Tenta de novo?",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-0 shadow-md w-full max-w-md">
      <CardContent className="p-6 sm:p-8 space-y-5">
        <div className="flex justify-center">
          <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
            <Send className="h-7 w-7 text-amber-600" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-display font-bold text-[#3D2B1F]">
            Boa! 🎉
          </h1>
          <p className="text-sm text-foreground leading-relaxed">
            Agora deixa eu te mandar uma notificação de teste pra ter certeza
            que tá tudo certo.
          </p>
        </div>

        {!askingConfirmation && (
          <Button
            size="lg"
            className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            onClick={handleSendTest}
            disabled={sending || sent}
          >
            <Send className="h-4 w-4 mr-2" />
            {sending
              ? "Enviando..."
              : sent
                ? "Enviada! Aguarda chegar..."
                : "Enviar notificação de teste"}
          </Button>
        )}

        {askingConfirmation && (
          <div className="space-y-3">
            <p className="text-center text-sm font-semibold text-[#3D2B1F]">
              Recebeu a notificação?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                className="bg-amber-500 hover:bg-amber-600 text-white"
                onClick={onConfirmed}
              >
                <Check className="h-4 w-4 mr-1" />
                Sim, recebi
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  setAskingConfirmation(false);
                  setSent(false);
                  onRetry();
                }}
              >
                <X className="h-4 w-4 mr-1" />
                Não recebi
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Se não recebeu, vamos refazer o passo a passo juntos.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
