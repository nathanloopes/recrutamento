import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

interface AIConsentGateProps {
  onAccept: () => void;
  onDecline: () => void;
}

export function AIConsentGate({ onAccept, onDecline }: AIConsentGateProps) {
  const [checked, setChecked] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-primary" />
          Uso de Inteligência Artificial
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-foreground/80">
        <p>
          Utilizamos Inteligência Artificial (OpenAI) para transcrever e analisar respostas do processo seletivo.
        </p>
        <p>
          Ao continuar, você concorda com o envio das informações necessárias (como respostas em texto e gravações de voz, quando utilizadas) exclusivamente para essa finalidade.
        </p>
        <p className="text-xs text-muted-foreground">
          Consulte nossa{" "}
          <Link to="/politica-de-privacidade" className="underline text-primary" target="_blank" rel="noopener">
            Política de Privacidade
          </Link>{" "}
          para saber como seus dados são tratados.
        </p>

        <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            className="mt-0.5"
          />
          <span className="text-sm">
            Li e concordo com o envio das minhas respostas e gravações à OpenAI para
            fins deste processo seletivo.
          </span>
        </label>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            className="flex-1"
            disabled={!checked}
            onClick={onAccept}
          >
            Aceito o processamento por IA
          </Button>
          <Button variant="outline" className="flex-1" onClick={onDecline}>
            Recusar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
