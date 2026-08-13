import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Activity } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useUnitActivityHistory } from "@/hooks/useUnitAccompaniment";

interface Props {
  unitName: string;
  franqueadoIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detalhe da coluna "Frequência": histórico das ações reais do(s) franqueado(s)
 * da unidade, a partir de activity_logs, com rótulos em pt-BR.
 */
export function UnitFrequencyDialog({ unitName, franqueadoIds, open, onOpenChange }: Props) {
  const { data, isLoading } = useUnitActivityHistory(franqueadoIds, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" /> Histórico de uso
          </DialogTitle>
          <DialogDescription>{unitName}</DialogDescription>
        </DialogHeader>

        {franqueadoIds.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhum franqueado atribuído a esta unidade.
          </p>
        ) : isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma ação registrada.
          </p>
        ) : (
          <ol className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
            {data.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                <span className="text-sm">{e.label}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {(() => {
                    try {
                      return format(parseISO(e.createdAt), "dd/MM/yyyy HH:mm");
                    } catch {
                      return "—";
                    }
                  })()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
