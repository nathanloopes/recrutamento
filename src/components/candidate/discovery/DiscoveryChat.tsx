import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { useDiscoveryQuestions, rankJobsByAnswers, type DiscoveryJob } from "./useDiscoveryQuestions";

interface DiscoveryChatProps {
  jobs: DiscoveryJob[];
  areaActivityLabel?: string;
  candidateFirstName?: string;
  onAcceptJob: (jobId: string) => void;
  onChangeArea: () => void;
}

function getJobInvite(job: DiscoveryJob): string {
  if (job.discovery_invite && job.discovery_invite.trim()) return job.discovery_invite.trim();
  return `Esse cargo combina com quem gosta de fazer parte do dia a dia da loja e cuidar bem das pessoas.`;
}

function getJobHighlights(job: DiscoveryJob): string[] {
  const raw = Array.isArray(job.discovery_highlights) ? job.discovery_highlights : [];
  const items: string[] = [];
  for (const h of raw) {
    if (typeof h === "string" && h.trim()) items.push(h.trim());
    else if (h && typeof h === "object" && typeof h.body === "string" && h.body.trim()) {
      items.push(h.title ? `${h.title}: ${h.body}` : h.body);
    }
  }
  return items;
}

export function DiscoveryChat({
  jobs,
  areaActivityLabel,
  onAcceptJob,
  onChangeArea,
}: DiscoveryChatProps) {
  const { jobAffinities } = useDiscoveryQuestions(jobs);
  const ranked = useMemo(
    () => rankJobsByAnswers(jobs, jobAffinities, []),
    [jobs, jobAffinities],
  );
  const [index, setIndex] = useState(0);
  const currentJob = ranked[index];

  if (jobs.length === 0 || !currentJob) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-12rem)] px-5 py-10 items-center justify-center">
        <Card className="border-0 shadow-sm w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="text-4xl">💛</div>
            <p className="text-base font-medium text-foreground">
              Por enquanto não tenho vagas dessa área pra te mostrar.
            </p>
            <Button variant="outline" onClick={onChangeArea}>
              Escolher outra área
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const invite = getJobInvite(currentJob);
  const highlights = getJobHighlights(currentJob);
  const hasMore = index < ranked.length - 1;

  const handleSeeOthers = () => {
    if (hasMore) setIndex((i) => i + 1);
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-9rem)] px-5 pt-8 pb-6">
      <div className="flex-1 space-y-7 max-w-xl mx-auto w-full">
        {/* Selo de conclusão */}
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          <span>
            {areaActivityLabel
              ? `Pelo que você me contou: "${areaActivityLabel}"`
              : "Pelo que você me contou…"}
          </span>
        </div>

        {/* Título / conclusão */}
        <div className="space-y-3">
          <h1 className="text-2xl font-display font-bold text-foreground leading-tight">
            Acho que você se encaixa super bem como
          </h1>
          <p className="text-3xl font-display font-extrabold text-primary leading-tight break-words">
            {currentJob.title}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">aqui na Recruta.</p>
        </div>

        {/* Convite */}
        <div className="rounded-2xl bg-muted/50 p-5">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{invite}</p>
        </div>

        {/* Highlights */}
        {highlights.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              O que mais combina
            </h2>
            <ul className="space-y-2.5">
              {highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-foreground leading-relaxed">{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* CTAs */}
      <div className="max-w-xl mx-auto w-full pt-8 space-y-2">
        <Button
          size="lg"
          className="w-full"
          onClick={() => onAcceptJob(currentJob.id)}
        >
          Quero saber mais sobre esse cargo
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
        {hasMore && (
          <Button size="lg" variant="ghost" className="w-full" onClick={handleSeeOthers}>
            Prefiro ver outras opções
          </Button>
        )}
        <button
          type="button"
          onClick={onChangeArea}
          className="block w-full text-center text-xs text-muted-foreground hover:text-primary pt-3"
        >
          ← Trocar área de interesse
        </button>
      </div>
    </div>
  );
}
