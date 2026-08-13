import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { ymdToLocalDate, dateToLocalYMD } from "@/lib/dateUtils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  Trash2,
  ExternalLink,
} from "lucide-react";
import {
  useChatSendErrors,
  useResendChatError,
  useDiscardChatError,
  type ChatSendError,
} from "@/hooks/useChatSendErrors";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Link } from "react-router-dom";

function StatusBadge({ status }: { status: ChatSendError["status"] }) {
  if (status === "failed") return <Badge variant="destructive">Falhou</Badge>;
  if (status === "resent") return <Badge variant="secondary">Reenviado</Badge>;
  return <Badge variant="outline">Descartado</Badge>;
}

export function ChatErrorsAuditTab() {
  const [status, setStatus] = useState<"failed" | "resent" | "discarded" | "all">("failed");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<ChatSendError | null>(null);

  const { data: rows, isLoading, refetch } = useChatSendErrors({
    status,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const resend = useResendChatError();
  const discard = useDiscardChatError();

  const handleResend = async (row: ChatSendError) => {
    try {
      await resend.mutateAsync(row);
      toast.success("Mensagem reenviada com sucesso.");
      setSelected(null);
    } catch (e: any) {
      toast.error("Falha ao reenviar: " + (e?.message || "tente novamente"));
    }
  };

  const handleDiscard = async (row: ChatSendError) => {
    try {
      await discard.mutateAsync(row);
      toast.success("Registro descartado.");
      setSelected(null);
    } catch (e: any) {
      toast.error("Falha ao descartar: " + (e?.message || "tente novamente"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5" /> Falhas de envio em conversas
          </h3>
          <p className="text-sm text-muted-foreground">
            Tentativas de envio de mensagem que retornaram erro. Permite reenviar
            ou descartar.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="failed">Falhou</SelectItem>
            <SelectItem value="resent">Reenviado</SelectItem>
            <SelectItem value="discarded">Descartado</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
        <MaskedDateInput
          value={ymdToLocalDate(dateFrom)}
          onChange={(d) => setDateFrom(dateToLocalYMD(d))}
          format="dd/MM/yyyy"
          placeholder="Data início"
          className="sm:w-[160px]"
        />
        <MaskedDateInput
          value={ymdToLocalDate(dateTo)}
          onChange={(d) => setDateTo(dateToLocalYMD(d))}
          format="dd/MM/yyyy"
          placeholder="Data fim"
          className="sm:w-[160px]"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !rows?.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquareWarning className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>Nenhuma falha de envio encontrada para os filtros aplicados.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/hora</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead>Tentativas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(r.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>{r.sender_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.sender_role}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate">{r.body}</TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="font-mono text-xs">{r.error_code || "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.error_message}
                      </div>
                    </TableCell>
                    <TableCell>{r.attempts}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {r.status === "failed" && r.thread_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={resend.isPending}
                          onClick={() => handleResend(r)}
                        >
                          <RefreshCw className="h-3 w-3" /> Reenviar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da falha de envio</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <strong>Data:</strong>{" "}
                  {format(new Date(selected.created_at), "dd/MM/yyyy HH:mm:ss", {
                    locale: ptBR,
                  })}
                </div>
                <div>
                  <strong>Remetente:</strong> {selected.sender_name}
                </div>
                <div>
                  <strong>Papel:</strong>{" "}
                  <Badge variant="outline">{selected.sender_role}</Badge>
                </div>
                <div>
                  <strong>Status:</strong> <StatusBadge status={selected.status} />
                </div>
                <div>
                  <strong>Tentativas:</strong> {selected.attempts}
                </div>
                {selected.thread_id && (
                  <div className="sm:col-span-2">
                    <strong>Thread:</strong>{" "}
                    <Link
                      to={`/admin/mensagens/${selected.thread_id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Abrir conversa <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Mensagem tentada</h4>
                <pre className="bg-muted p-3 rounded-md text-xs whitespace-pre-wrap max-h-[200px] overflow-auto">
                  {selected.body}
                </pre>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Erro técnico</h4>
                <div className="font-mono text-xs mb-1">{selected.error_code || "—"}</div>
                <pre className="bg-muted p-3 rounded-md text-xs whitespace-pre-wrap max-h-[200px] overflow-auto">
                  {selected.error_message || "—"}
                </pre>
              </div>

              {selected.status === "failed" && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={discard.isPending}
                    onClick={() => handleDiscard(selected)}
                  >
                    <Trash2 className="h-3 w-3" /> Descartar
                  </Button>
                  {selected.thread_id && (
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={resend.isPending}
                      onClick={() => handleResend(selected)}
                    >
                      {resend.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Reenviar agora
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
