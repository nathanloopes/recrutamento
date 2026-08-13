import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaAnswerInput } from "@/components/candidate/MediaAnswerInput";

interface MediaStepProps {
  title: string;
  type: "video" | "audio" | "imagem";
  content: { url?: string; prompt?: string };
  onSubmit: (response: any) => void;
  isSubmitting: boolean;
  applicationId: string;
  candidateId: string;
  questionIndex: number;
}

export function MediaStep({
  title,
  type,
  content,
  onSubmit,
  isSubmitting,
  applicationId,
  candidateId,
  questionIndex,
}: MediaStepProps) {
  const [filePath, setFilePath] = useState("");
  const [comment, setComment] = useState("");

  const labelByType = {
    video: "Envie um vídeo como resposta",
    audio: "Envie um áudio como resposta",
    imagem: "Envie uma imagem como resposta",
  }[type];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {type === "video" && content?.url && (
          <video src={content.url} controls className="w-full rounded-lg" />
        )}
        {type === "audio" && content?.url && (
          <audio src={content.url} controls className="w-full" />
        )}
        {type === "imagem" && content?.url && (
          <img src={content.url} alt={title} className="w-full rounded-lg" />
        )}

        {content?.prompt && (
          <p className="text-sm text-foreground">{content.prompt}</p>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{labelByType}</p>
          <MediaAnswerInput
            mode={type}
            value={filePath}
            onChange={setFilePath}
            assignmentId={applicationId}
            candidateId={candidateId}
            questionIndex={questionIndex}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Comentário (opcional)</p>
          <Textarea
            placeholder="Quer adicionar algum comentário sobre sua resposta?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
        </div>

        <Button
          onClick={() => onSubmit({ type, file_url: filePath, text: comment })}
          disabled={!filePath || isSubmitting}
          className="w-full"
        >
          {isSubmitting ? "Enviando..." : "Enviar Resposta"}
        </Button>
      </CardContent>
    </Card>
  );
}
