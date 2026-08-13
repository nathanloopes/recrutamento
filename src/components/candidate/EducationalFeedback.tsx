import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, TrendingUp, RefreshCw, Lightbulb, PlayCircle, FileText } from "lucide-react";
import { Link } from "react-router-dom";

export interface EducationalContentItem {
  type: "video" | "text" | "link";
  title: string;
  url?: string;
  body?: string;
}

interface EducationalFeedbackProps {
  score?: number;
  jobTitle?: string;
  cooldownDays?: number;
  strengths?: string[];
  improvements?: string[];
  educationalContent?: EducationalContentItem[];
}

const DEFAULT_TIPS = [
  "Revise suas respostas com calma antes de enviar",
  "Pesquise sobre a empresa e o cargo antes da triagem",
  "Mantenha seu perfil sempre atualizado",
  "Pratique respostas para perguntas comportamentais",
  "Destaque suas experiências mais relevantes para a vaga",
];

export function EducationalFeedback({
  score,
  jobTitle,
  cooldownDays = 90,
  strengths = [],
  improvements = [],
  educationalContent = [],
}: EducationalFeedbackProps) {
  const tips = improvements.length > 0 ? improvements : DEFAULT_TIPS;

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-amber-600" />
          Feedback do seu processo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {jobTitle && (
          <p className="text-sm text-muted-foreground">
            Cargo: <strong>{jobTitle}</strong>
          </p>
        )}

        {score != null && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-sm">
              Score: {score}/100
            </Badge>
          </div>
        )}

        {strengths.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Seus pontos fortes
            </p>
            <ul className="space-y-1">
              {strengths.map((s, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-emerald-600 mt-0.5">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Dynamic educational content from pipeline */}
        {educationalContent.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-primary" />
              Conteúdo para você se preparar
            </p>
            <div className="space-y-2">
              {educationalContent.map((item, i) => (
                <div key={i} className="bg-muted/50 rounded-lg p-3 flex items-start gap-3">
                  {item.type === "video" ? (
                    <PlayCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  ) : (
                    <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.body && (
                      <p className="text-xs text-muted-foreground mt-1">{item.body}</p>
                    )}
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary underline mt-1 inline-block"
                      >
                        {item.type === "video" ? "Assistir vídeo" : "Acessar conteúdo"}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Lightbulb className="h-4 w-4 text-amber-600" />
            Dicas para melhorar
          </p>
          <ul className="space-y-1">
            {tips.slice(0, 5).map((tip, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="text-amber-600 mt-0.5">→</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>

        {cooldownDays > 0 && (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              <span>
                Você poderá se candidatar novamente em <strong>{cooldownDays} dias</strong>.
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Use esse período para se preparar melhor!
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Link to="/oportunidades">
            <Button variant="outline" size="sm">
              Ver outras vagas
            </Button>
          </Link>
          <Link to="/faq">
            <Button variant="ghost" size="sm">
              Dúvidas frequentes
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
