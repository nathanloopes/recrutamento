import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, CheckCircle, XCircle } from "lucide-react";

function useDocumentDispatchAudit() {
  return useQuery({
    queryKey: ["document_dispatch_audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_dispatch_audit" as any)
        .select("*")
        .order("dispatched_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function DocumentDispatchAuditTab() {
  const { data: dispatches, isLoading } = useDocumentDispatchAudit();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="h-5 w-5" /> Histórico de Envios de Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidato</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead>Entregue</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!dispatches || dispatches.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Nenhum envio registrado.
                  </TableCell>
                </TableRow>
              ) : (
                dispatches.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.candidate_name || "—"}</TableCell>
                    <TableCell>{d.job_title || "—"}</TableCell>
                    <TableCell>{d.unit_name || "—"}</TableCell>
                    <TableCell className="text-xs">{d.destination_email || "—"}</TableCell>
                    <TableCell className="text-center">{d.documents_count ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{d.delivery_mode || "email"}</Badge>
                    </TableCell>
                    <TableCell>
                      {d.delivered ? (
                        <CheckCircle className="h-4 w-4 text-primary" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.dispatched_at ? new Date(d.dispatched_at).toLocaleString("pt-BR") : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
