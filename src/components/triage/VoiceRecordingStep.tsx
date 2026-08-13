import { useState, useCallback } from "react";
import { VoiceTestStep } from "@/components/candidate/VoiceTestStep";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface VoiceRecordingStepProps {
  title: string;
  content: {
    questions?: { id?: string; text: string; max_seconds?: number; block?: string; weight?: number }[];
    allow_repeat?: boolean;
    consent_text?: string;
    question?: string;
  };
  stepId: string;
  applicationId: string;
  onSubmit: (response: any, score?: number) => void;
  isSubmitting: boolean;
}

export function VoiceRecordingStep({ title, content, stepId, applicationId, onSubmit, isSubmitting }: VoiceRecordingStepProps) {
  const { user } = useAuth();
  const [evaluating, setEvaluating] = useState(false);

  // Normalize questions - support single question or array
  const questions = content?.questions?.length
    ? content.questions.map((q, i) => ({
        id: q.id || `vq_${i}`,
        text: q.text,
        max_seconds: q.max_seconds || 120,
        block: q.block,
        weight: q.weight || 1,
        rubric: (q as any).rubric || q.block || undefined,
      }))
    : [{
        id: "vq_0",
        text: content?.question || title,
        max_seconds: 120,
        weight: 1,
      }];

  const handleComplete = useCallback(async (
    audioUrls: Record<string, string>,
    voiceQuestions: { id: string; text: string; weight?: number }[]
  ) => {
    setEvaluating(true);
    try {
      // Enrich questions with rubric for better AI evaluation
      const enrichedQuestions = voiceQuestions.map(vq => {
        const fullQ = questions.find(q => q.id === vq.id) as any;
        return {
          ...vq,
          rubric: fullQ?.rubric || fullQ?.block || undefined,
        };
      });

      const { data, error } = await supabase.functions.invoke("evaluate-test-voice", {
        body: {
          audio_urls: audioUrls,
          questions: enrichedQuestions,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const score = data?.score ?? 0;
      onSubmit(
        { type: "voice", audio_urls: audioUrls, evaluation: data },
        score
      );
    } catch (err: any) {
      console.error("Voice evaluation error:", err);
      // Submit without score so admin can evaluate manually
      onSubmit({ type: "voice", audio_urls: audioUrls }, undefined);
      toast({ title: "Avaliação automática falhou", description: "O gestor avaliará manualmente.", variant: "default" });
    } finally {
      setEvaluating(false);
    }
  }, [questions, onSubmit]);

  if (evaluating) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <Loader2 className="h-12 w-12 text-primary mx-auto animate-spin" />
          <h2 className="text-lg font-semibold text-foreground">Avaliando sua resposta...</h2>
          <p className="text-sm text-muted-foreground">A IA está transcrevendo e avaliando seu áudio.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <VoiceTestStep
      assignmentId={`triage_${stepId}`}
      candidateId={user?.id || "unknown"}
      template={{
        title,
        description: undefined,
        content: {
          questions,
          allow_repeat: content?.allow_repeat ?? true,
          consent_text: content?.consent_text,
        },
      }}
      onComplete={handleComplete}
      isSubmitting={isSubmitting || evaluating}
    />
  );
}
