export type InterviewState =
  | "idle"
  | "ai_typing"
  | "awaiting_answer"
  | "processing"
  | "next_question"
  | "finished";

export interface InterviewQuestion {
  id: string;
  type: "quiz" | "dissertativa" | "voice" | "multiple_choice" | "true_false" | "essay" | "scenario" | "scale" | "voice_question";
  text: string;
  options?: { text: string; correct?: boolean }[];
  rubric?: string;
  weight?: number;
  context?: string;
  scale_labels?: { min: string; max: string };
}

export function normalizeQuestionType(type: string): InterviewQuestion["type"] {
  const map: Record<string, InterviewQuestion["type"]> = {
    multiple_choice: "quiz",
    true_false: "quiz",
    essay: "dissertativa",
    scenario: "dissertativa",
    text: "dissertativa",
    texto: "dissertativa",
    voice_question: "voice",
    voice: "voice",
    quiz: "quiz",
    dissertativa: "dissertativa",
    scale: "dissertativa",
  };
  return map[type] || "dissertativa";
}

const AI_REACTIONS = [
  "Ótima resposta! Vamos continuar.",
  "Interessante. Próxima pergunta.",
  "Entendi. Seguindo em frente.",
  "Obrigado pela resposta. Vamos adiante.",
  "Anotado. Continuemos.",
  "Boa análise. Próxima questão.",
  "Compreendido. Vamos prosseguir.",
  "Certo, vamos para a próxima.",
];

export function getAIReaction(): string {
  return AI_REACTIONS[Math.floor(Math.random() * AI_REACTIONS.length)];
}
