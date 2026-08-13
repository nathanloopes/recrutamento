import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TextStepProps {
  title: string;
  content: any;
  onSubmit: (response: any) => void;
  isSubmitting: boolean;
  initialResponse?: any;
}

export function TextStep({ title, content, onSubmit, isSubmitting, initialResponse }: TextStepProps) {
  const [answer, setAnswer] = useState<string>(typeof initialResponse?.text === "string" ? initialResponse.text : "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {content?.prompt && (
          <p className="text-sm text-foreground">{content.prompt}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="Digite sua resposta..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={6}
        />
        <Button
          onClick={() => onSubmit({ text: answer })}
          disabled={!answer.trim() || isSubmitting}
          className="w-full"
        >
          {isSubmitting ? "Enviando..." : "Enviar Resposta"}
        </Button>
      </CardContent>
    </Card>
  );
}
