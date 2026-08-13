import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useIntegrationLogs } from "@/hooks/useIntegrations";

interface Props {
  integrationId: string | null;
  providerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IntegrationLogsPanel({ integrationId, providerName, open, onOpenChange }: Props) {
  const { data: logs, isLoading } = useIntegrationLogs(integrationId || undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico — {providerName.toUpperCase()}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !logs?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum evento registrado.</p>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {log.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <Badge variant="outline">{log.event}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {log.context && Object.keys(log.context).length > 0 && (
                    <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-24">
                      {JSON.stringify(log.context, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
