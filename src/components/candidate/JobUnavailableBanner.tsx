import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEquivalentOpenJobs } from "@/hooks/useEquivalentOpenJobs";
import { useCandidateTestStatus } from "@/hooks/useCargoTest";

/**
 * Aviso, na barra de progresso do candidato, de que a VAGA daquele processo
 * deixou de estar disponível (pausada/preenchida/encerrada). Quando existe a
 * MESMA vaga (mesmo cargo) aberta em outra unidade e o candidato já passou na
 * triagem do cargo, oferece continuar sem refazer a triagem.
 *
 * Substitui apenas a informação daquele processo — não altera os demais.
 * Não renderiza nada quando a vaga está `aberta`.
 */

const VAGA_STATUS_LABEL: Record<string, string> = {
  pausada: "Vaga pausada",
  preenchida: "Vaga preenchida",
  encerrada: "Vaga encerrada",
};

interface Props {
  jobStatus?: string | null;
  jobId?: string | null;
  unitJobId?: string | null;
}

export function JobUnavailableBanner({ jobStatus, jobId, unitJobId }: Props) {
  const navigate = useNavigate();
  const unavailable = !!jobStatus && jobStatus !== "aberta";

  const { data: equivalents } = useEquivalentOpenJobs(unavailable ? jobId : null, unitJobId);
  const { data: testStatus } = useCandidateTestStatus(unavailable ? jobId || undefined : undefined);

  if (!unavailable) return null;

  const label = VAGA_STATUS_LABEL[jobStatus!] || "Vaga indisponível";
  const hasEquivalents = (equivalents?.length || 0) > 0;
  const triagemApproved = !!testStatus?.isApproved;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </div>
      {hasEquivalents && triagemApproved && (
        <>
          <p className="text-xs leading-snug text-amber-800/90 dark:text-amber-200/80">
            Há a mesma vaga disponível em outra unidade. Você pode continuar sem refazer a triagem.
          </p>
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => navigate(`/unidades-disponiveis?cargo=${jobId}&reuse=1`)}
          >
            Ver vaga em outra unidade
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
