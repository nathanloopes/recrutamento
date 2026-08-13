import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft } from "lucide-react";

interface QuizOption {
  text: string;
  correct?: boolean;
}

interface QuizQuestion {
  question: string;
  options: (string | QuizOption)[];
  correct?: number;
}

interface QuizStepProps {
  title: string;
  content: {
    question?: string;
    options?: QuizOption[];
    questions?: QuizQuestion[];
  };
  onSubmit: (response: any, score: number) => void;
  isSubmitting: boolean;
  initialResponse?: any;
}

export function QuizStep({ title, content, onSubmit, isSubmitting, initialResponse }: QuizStepProps) {
  const questions: QuizQuestion[] = content?.questions || [];
  const isSingleQuestion = questions.length === 0 && content?.options;

  if (isSingleQuestion) {
    return (
      <SingleQuestionQuiz
        title={title}
        question={content.question}
        options={content.options!}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
        initialResponse={initialResponse}
      />
    );
  }

  return (
    <MultiQuestionQuiz
      title={title}
      questions={questions}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
      initialResponse={initialResponse}
    />
  );
}

function SingleQuestionQuiz({
  title,
  question,
  options,
  onSubmit,
  isSubmitting,
  initialResponse,
}: {
  title: string;
  question?: string;
  options: QuizOption[];
  onSubmit: (response: any, score: number) => void;
  isSubmitting: boolean;
  initialResponse?: any;
}) {
  const [selected, setSelected] = useState<string>(
    initialResponse?.selected_index != null ? String(initialResponse.selected_index) : ""
  );

  const handleSubmit = () => {
    const idx = parseInt(selected);
    const isCorrect = options[idx]?.correct === true;
    const score = isCorrect ? 100 : 0;
    onSubmit({ selected_index: idx, selected_text: options[idx]?.text }, score);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {question && <p className="text-sm text-foreground">{question}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={selected} onValueChange={setSelected}>
          {options.map((opt, i) => (
            <label
              key={i}
              htmlFor={`opt-${i}`}
              className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 hover:border-primary/40 transition-colors cursor-pointer [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
            >
              <RadioGroupItem value={String(i)} id={`opt-${i}`} />
              <Label htmlFor={`opt-${i}`} className="flex-1 cursor-pointer">{opt.text}</Label>
            </label>
          ))}
        </RadioGroup>
        <Button onClick={handleSubmit} disabled={selected === "" || isSubmitting} className="w-full">
          {isSubmitting ? "Enviando..." : "Confirmar Resposta"}
        </Button>
      </CardContent>
    </Card>
  );
}

function MultiQuestionQuiz({
  title,
  questions,
  onSubmit,
  isSubmitting,
  initialResponse,
}: {
  title: string;
  questions: QuizQuestion[];
  onSubmit: (response: any, score: number) => void;
  isSubmitting: boolean;
  initialResponse?: any;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    if (Array.isArray(initialResponse?.answers)) {
      initialResponse.answers.forEach((a: any, i: number) => {
        if (a?.selected_index != null) init[i] = String(a.selected_index);
      });
    }
    return init;
  });

  const isLast = currentIdx === questions.length - 1;
  const q = questions[currentIdx];
  const opts = q?.options.map((o) => (typeof o === "string" ? o : o.text)) || [];
  const selectedValue = answers[currentIdx] ?? "";
  const progress = questions.length > 0 ? Math.round(((currentIdx + 1) / questions.length) * 100) : 0;

  const handleNext = () => {
    if (isLast) {
      let correctCount = 0;
      const details = questions.map((qq, i) => {
        const selectedIdx = parseInt(answers[i]);
        const isCorrect = qq.correct !== undefined ? selectedIdx === qq.correct : false;
        if (isCorrect) correctCount++;
        const optText = typeof qq.options[selectedIdx] === "string" ? qq.options[selectedIdx] : (qq.options[selectedIdx] as QuizOption)?.text;
        return { question: qq.question, selected_index: selectedIdx, selected_text: optText, correct: isCorrect };
      });
      const score = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
      onSubmit({ answers: details }, score);
    } else {
      setCurrentIdx((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentIdx > 0) setCurrentIdx((prev) => prev - 1);
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        {title && <CardTitle className="text-lg">{title}</CardTitle>}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Pergunta {currentIdx + 1} de {questions.length}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="font-medium text-sm text-foreground">{currentIdx + 1}. {q.question}</p>
        <RadioGroup
          value={selectedValue}
          onValueChange={(v) => setAnswers((prev) => ({ ...prev, [currentIdx]: v }))}
        >
          {opts.map((optText, oi) => (
            <label
              key={oi}
              htmlFor={`q${currentIdx}-o${oi}`}
              className="flex items-center space-x-2 p-2.5 rounded-lg border hover:bg-muted/50 hover:border-primary/40 transition-colors cursor-pointer [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
            >
              <RadioGroupItem value={String(oi)} id={`q${currentIdx}-o${oi}`} />
              <Label htmlFor={`q${currentIdx}-o${oi}`} className="flex-1 cursor-pointer text-sm">{optText}</Label>
            </label>
          ))}
        </RadioGroup>
        <div className="flex gap-2">
          {currentIdx > 0 && (
            <Button variant="ghost" onClick={handleBack} className="text-muted-foreground">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
          )}
          <Button
            onClick={handleNext}
            disabled={selectedValue === "" || isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? "Enviando..." : isLast ? "Confirmar Respostas" : "Próxima"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}