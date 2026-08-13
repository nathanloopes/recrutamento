import { useNavigate } from "react-router-dom";
import { MapPin, Building2, Sparkles, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTalentInvites } from "@/hooks/useTalentPool";

interface Props {
  /** Para evitar sugerir a mesma vaga que o candidato acabou de confirmar */
  excludeUnitJobId?: string;
}

/**
 * Bloco "🔄 Reaproveitamento Final" — sugere até 3 outras vagas compatíveis
 * a partir dos talent_invites já gerados pelo motor `auto_dispatch_talent_matching`.
 * Sem RPC nova: reusa o pipeline existente.
 */
export function ReaproveitamentoCarousel({ excludeUnitJobId }: Props) {
  const navigate = useNavigate();
  const { data: invites, isLoading } = useTalentInvites();

  // Filtra: pendentes, com unit_job válido e ≠ da vaga recém-confirmada
  const pending = (invites || []).filter(
    (inv: any) =>
      inv.status === "pending" &&
      inv.unit_job_id !== excludeUnitJobId &&
      inv.unit_jobs?.units?.name
  );

  const top3 = pending.slice(0, 3);

  return (
    <div className="space-y-3" data-tour="reaproveitamento-carousel">
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">🔄</span>
        <h2 className="text-sm font-semibold text-foreground">
          Reaproveitamento final
        </h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">Mesmo no final:</p>

      {isLoading && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 w-64 shrink-0 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && top3.length === 0 && (
        <Card className="border-dashed bg-amber-50/40 dark:bg-amber-900/10">
          <CardContent className="p-4 space-y-3 text-center">
            <Sparkles className="h-6 w-6 text-primary mx-auto" />
            <p className="text-sm text-foreground/90 leading-relaxed">
              Por enquanto não temos outras vagas abertas com o seu perfil,
              mas vamos te avisar assim que abrirmos 💛
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/banco-de-talentos")}
            >
              Ir para o Banco de Talentos
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && top3.length > 0 && (
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4">
          {top3.map((inv: any) => {
            const job = inv.unit_jobs?.jobs;
            const unit = inv.unit_jobs?.units;
            return (
              <Card
                key={inv.id}
                className="shrink-0 w-64 snap-start border-0 shadow-sm flex flex-col min-w-0 overflow-hidden"
              >
                <CardContent className="p-4 space-y-3 flex flex-col flex-1">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <h3 className="font-semibold text-sm text-foreground truncate">
                        {job?.title || "Vaga compatível"}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate">
                        {unit?.name} · {unit?.city}/{unit?.state}
                      </span>
                    </div>
                  </div>

                  <Badge variant="secondary" className="self-start text-[10px]">
                    <Sparkles className="h-2.5 w-2.5 mr-1" />
                    Compatível com você
                  </Badge>

                  <div className="mt-auto pt-2">
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => navigate("/banco-de-talentos")}
                    >
                      Quero me candidatar também
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
