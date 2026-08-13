import { useState, useEffect } from "react";
import { Compass, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface LinkOriginBannerProps {
  applicationId: string;
  jobTitle?: string;
  unitName?: string;
  isTerminal?: boolean;
}

/**
 * Banner contextual para candidatos que entraram via link direto (/v/:token).
 * - Em estado ativo: lembra que há outras vagas no portal além desse link.
 * - Em estado terminal (encerrado): convida a explorar /oportunidades.
 * Persistência da escolha de fechar via localStorage por application.
 */
export function LinkOriginBanner({ applicationId, jobTitle, unitName, isTerminal }: LinkOriginBannerProps) {
  const storageKey = `link_origin_banner_dismissed:${applicationId}`;
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "1");
    setDismissed(true);
  };

  const headline = isTerminal
    ? "Que tal explorar mais oportunidades?"
    : "Você entrou por um convite direto";

  const body = isTerminal
    ? "Esse processo foi encerrado, mas o portal tem outras vagas em diferentes unidades e regiões. Vamos dar uma olhada juntos?"
    : `Você está no processo de ${jobTitle || "essa vaga"}${unitName ? ` em ${unitName}` : ""}. Lembre que o portal tem outras vagas em outras unidades esperando por você caso essa não seja a ideal.`;

  return (
    <div className="relative rounded-lg border border-primary/20 bg-primary/5 p-4 flex gap-3 items-start">
      <Compass className="h-5 w-5 text-primary mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="font-semibold text-sm text-foreground">{headline}</div>
        <p className="text-sm text-muted-foreground">{body}</p>
        <Button
          size="sm"
          variant={isTerminal ? "default" : "outline"}
          className="mt-1"
          onClick={() => navigate(isTerminal ? "/oportunidades" : "/inicio")}
        >
          {isTerminal ? "Explorar outras vagas" : "Ir para o início"}
        </Button>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Dispensar aviso"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
