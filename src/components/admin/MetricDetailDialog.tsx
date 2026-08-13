import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWithdrawalAnalysis, useRejectionAnalysis } from "@/hooks/useMetricAnalysis";
import { format } from "date-fns";

interface MetricDetailDialogProps {
  type: "withdrawal" | "rejection" | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MetricDetailDialog({ type, open, onOpenChange }: MetricDetailDialogProps) {
  if (!type) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>
            {type === "withdrawal" ? "Análise de Desistências" : "Análise de Standby"}
          </DialogTitle>
          <DialogDescription>
            {type === "withdrawal"
              ? "Detalhamento das desistências por etapa, motivos e unidades"
              : "Detalhamento das reprovações por etapa, justificativas e unidades"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh]">
          {type === "withdrawal" ? <WithdrawalContent /> : <RejectionContent />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawalContent() {
  const { data, isLoading } = useWithdrawalAnalysis();

  if (isLoading) return <p className="text-sm text-muted-foreground py-4">Carregando...</p>;
  if (!data?.total) return <p className="text-sm text-muted-foreground py-4">Nenhuma desistência registrada.</p>;

  return (
    <Tabs defaultValue="phase" className="space-y-4">
      <TabsList>
        <TabsTrigger value="phase">Por Etapa</TabsTrigger>
        <TabsTrigger value="reasons">Motivos</TabsTrigger>
        <TabsTrigger value="units">Por Unidade</TabsTrigger>
      </TabsList>

      <TabsContent value="phase">
        <p className="text-sm text-muted-foreground mb-2">Total: {data.total} desistências</p>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Etapa</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byPhase.map((p) => (
              <TableRow key={p.phase}>
                <TableCell className="font-medium">{p.phase}</TableCell>
                <TableCell className="text-right">{p.count}</TableCell>
                <TableCell className="text-right">{p.percentage}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </TabsContent>

      <TabsContent value="reasons">
        <div className="space-y-2">
          {data.reasons.map((r, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">{r.reason}</span>
              <Badge variant="secondary">{r.count}x</Badge>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="units">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead className="text-right">Desistências</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byUnit.slice(0, 10).map((u, i) => (
              <TableRow key={u.unitName}>
                <TableCell className="font-bold">{i + 1}º</TableCell>
                <TableCell>{u.unitName}</TableCell>
                <TableCell className="text-right">{u.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function RejectionContent() {
  const { data, isLoading } = useRejectionAnalysis();

  if (isLoading) return <p className="text-sm text-muted-foreground py-4">Carregando...</p>;
  if (!data?.total) return <p className="text-sm text-muted-foreground py-4">Nenhum registro de standby encontrado.</p>;

  return (
    <Tabs defaultValue="phase" className="space-y-4">
      <TabsList>
        <TabsTrigger value="phase">Por Etapa</TabsTrigger>
        <TabsTrigger value="feedback">Justificativas</TabsTrigger>
        <TabsTrigger value="units">Por Unidade</TabsTrigger>
      </TabsList>

      <TabsContent value="phase">
        <p className="text-sm text-muted-foreground mb-2">Total: {data.total} reprovações</p>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Etapa</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byPhase.map((p) => (
              <TableRow key={p.phase}>
                <TableCell className="font-medium">{p.phase}</TableCell>
                <TableCell className="text-right">{p.count}</TableCell>
                <TableCell className="text-right">{p.percentage}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </TabsContent>

      <TabsContent value="feedback">
        {data.feedbacks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhuma justificativa de entrevista encontrada.</p>
        ) : (
          <div className="space-y-3">
            {data.feedbacks.slice(0, 20).map((f, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-1">
                <p className="text-sm">{f.notes}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{f.decision}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(f.createdAt), "dd/MM/yyyy")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="units">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead className="text-right">Standby</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byUnit.slice(0, 10).map((u, i) => (
              <TableRow key={u.unitName}>
                <TableCell className="font-bold">{i + 1}º</TableCell>
                <TableCell>{u.unitName}</TableCell>
                <TableCell className="text-right">{u.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}
