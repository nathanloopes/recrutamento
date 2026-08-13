import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { DEFAULT_CLOSE_PROCESS_REASON } from "@/lib/userMessages";

interface CloseProcessDialogProps {
  /** id da candidatura (applications.id) a encerrar */
  applicationId?: string;
  /** status atual da candidatura, usado apenas no log de jornada (best-effort) */
  fromStatus?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** chamado após encerrar com sucesso (ex.: fechar o diálogo pai) */
  onClosed?: () => void;
}

/**
 * Fluxo único de "Encerrar processo" do candidato, reaproveitado entre o Painel
 * do Candidato (CandidateDetailPanel) e a Documentação (DocumentManagement).
 * Move a candidatura para `desligado` (mantém no Banco de Talentos), exige motivo
 * + confirmação digitada, e registra o evento na jornada. Governado pela RLS
 * existente de `applications` (mesma usada por aprovar/standby/pausar) — nenhuma
 * policy nova é necessária.
 */
export function CloseProcessDialog({ applicationId, fromStatus, open, onOpenChange, onClosed }: CloseProcessDialogProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(DEFAULT_CLOSE_PROCESS_REASON);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reseta os campos sempre que o diálogo abre.
  useEffect(() => {
    if (open) {
      setReason(DEFAULT_CLOSE_PROCESS_REASON);
      setConfirmText("");
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!applicationId) return;
    if (confirmText.trim().toUpperCase() !== "CONFIRMAR") {
      toast.error("Digite CONFIRMAR para encerrar o processo.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Informe o motivo do encerramento.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: "desligado", withdrawal_reason: reason.trim() } as any)
        .eq("id", applicationId);
      if (error) throw error;
      try {
        await supabase.rpc("log_application_journey", {
          p_application_id: applicationId,
          p_event_type: "process_closed_by_recruiter",
          p_from_status: fromStatus ?? null,
          p_to_status: "desligado",
          p_details: { reason: reason.trim() } as any,
        });
      } catch { /* journey log é best-effort */ }
      toast.success("Processo encerrado. Candidato continua no Banco de Talentos.");
      // Invalida ambas as telas que exibem a candidatura.
      queryClient.invalidateQueries({ queryKey: ["candidates-by-job"] });
      queryClient.invalidateQueries({ queryKey: ["candidates_by_job"] });
      queryClient.invalidateQueries({ queryKey: ["candidate-detail"] });
      queryClient.invalidateQueries({ queryKey: ["admin_document_requests"] });
      queryClient.invalidateQueries({ queryKey: ["application_status"] });
      onOpenChange(false);
      onClosed?.();
    } catch (e: any) {
      toast.error("Erro ao encerrar processo: " + (e?.message || ""));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" /> Encerrar processo do candidato
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Esta ação encerra o processo deste candidato nesta vaga. Ele continua no Banco de Talentos e pode ser reativado, mas sairá do board operacional.
            </AlertDescription>
          </Alert>
          <div className="space-y-1">
            <label className="text-xs font-medium">Motivo (uso interno) <span className="text-destructive">*</span></label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: Perfil incompatível com a vaga após análise final."
              className="text-sm min-h-[70px]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Digite <span className="font-mono">CONFIRMAR</span> para prosseguir</label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="CONFIRMAR"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={submitting || confirmText.trim().toUpperCase() !== "CONFIRMAR" || !reason.trim()}
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />}
            Encerrar processo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
