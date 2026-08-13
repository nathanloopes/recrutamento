import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, MapPin, TrendingUp, Gift, CheckCircle, Sparkles, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDateBR } from "@/lib/dateUtils";
import { resolveUnitJobLists } from "@/lib/resolveUnitJobLists";

interface JobDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uj: any;
  careerPlan?: any;
  alreadyApplied: boolean;
  onApply: () => void;
  isPending: boolean;
  aiExplainEnabled?: boolean;
}

export function JobDetailDialog({ open, onOpenChange, uj, careerPlan, alreadyApplied, onApply, isPending, aiExplainEnabled = true }: JobDetailDialogProps) {
  const { benefits, responsibilities, requirements } = resolveUnitJobLists(uj);
  const levels = careerPlan?.levels && Array.isArray(careerPlan.levels) ? careerPlan.levels : [];
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const { user } = useAuth();

  // Track candidate view (onCandidateView)
  useEffect(() => {
    if (open && user?.id && uj?.id) {
      supabase.from("activity_logs").insert({
        user_id: user.id,
        action: "candidate_viewed_job",
        module: "vagas",
        details: { unit_job_id: uj.id, job_title: uj.jobs?.title, unit_name: uj.units?.name },
      } as any).then(() => {});
    }
  }, [open, user?.id, uj?.id]);

  const handleExplainCareer = async () => {
    if (aiLoading || !levels.length) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("explain-career-plan", {
        body: { mode: "explain", career_plan: { levels } },
      });
      if (error) throw error;
      setAiExplanation(data?.explanation || "Não foi possível gerar a explicação.");
    } catch (e: any) {
      toast.error("Erro ao gerar explicação da IA");
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  };

  // Reset AI explanation when dialog closes
  useEffect(() => {
    if (!open) setAiExplanation(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{uj.jobs?.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5"><Building2 className="h-4 w-4" />{uj.units?.name}</div>
            <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{uj.units?.city}, {uj.units?.state}</div>
            {uj.closes_at && (() => {
              const ymd = String(uj.closes_at).slice(0, 10);
              const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (!m) return null;
              const endLocal = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const daysLeft = Math.ceil((endLocal - today.getTime()) / (1000 * 60 * 60 * 24));
              if (daysLeft < 0) return null;
              const fullDate = formatDateBR(uj.closes_at);
              const urgent = daysLeft <= 2;
              const attention = daysLeft <= 7;
              const cls = urgent
                ? "text-destructive font-medium"
                : attention
                ? "text-amber-700 font-medium"
                : "text-muted-foreground";
              const text = daysLeft === 0
                ? "Esta vaga encerra hoje"
                : daysLeft <= 7
                ? `Esta vaga encerra em ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}`
                : `Inscrições até ${fullDate}`;
              return <div className={`flex items-center gap-1.5 ${cls}`}>⏳ {text}</div>;
            })()}
          </div>

          {uj.jobs?.description && (
            <p className="text-sm text-foreground">{uj.jobs.description}</p>
          )}

          {uj.salary && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Salário</p>
              <p className="text-lg font-semibold text-primary">R$ {Number(uj.salary).toLocaleString("pt-BR")}</p>
            </div>
          )}

          {benefits.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><Gift className="h-3.5 w-3.5" />Benefícios</p>
              <div className="flex flex-wrap gap-1.5">
                {benefits.map((b: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs">{b}</Badge>
                ))}
              </div>
            </div>
          )}

          {responsibilities.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Responsabilidades</p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                {responsibilities.map((r: string, i: number) => (
                  <li key={i} className="leading-tight">{r}</li>
                ))}
              </ul>
            </div>
          )}

          {requirements.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Requisitos</p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                {requirements.map((r: string, i: number) => (
                  <li key={i} className="leading-tight">{r}</li>
                ))}
              </ul>
            </div>
          )}

          {levels.length > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" />Plano de Carreira</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nível</TableHead>
                    <TableHead className="text-xs">Faixa Salarial</TableHead>
                    <TableHead className="text-xs">Critérios</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {levels.map((l: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-medium">{l.name}</TableCell>
                      <TableCell className="text-sm">{l.salary_range || "—"}</TableCell>
                      <TableCell className="text-sm">{l.criteria || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* AI Explain Button */}
              {aiExplainEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full gap-1.5 text-xs"
                  onClick={handleExplainCareer}
                  disabled={aiLoading}
                >
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {aiLoading ? "Gerando explicação..." : "Entenda o plano de carreira com IA"}
                </Button>
              )}

              {aiExplanation && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg border text-sm text-foreground whitespace-pre-line">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Sparkles className="h-3 w-3" />Explicação da IA</p>
                  {aiExplanation}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Sem plano de carreira estruturado</p>
          )}

          <div className="pt-2">
            {alreadyApplied ? (
              <Badge variant="secondary" className="w-full justify-center py-2"><CheckCircle className="h-4 w-4 mr-1" />Já candidatado</Badge>
            ) : (
              <Button className="w-full" onClick={onApply} disabled={isPending}>Candidatar-se</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
