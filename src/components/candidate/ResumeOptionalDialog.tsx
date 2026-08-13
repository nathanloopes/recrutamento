import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  NativeFileInput,
  type NativeFileInputHandle,
} from "@/components/ui/NativeFileInput";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  uploadResume,
  validateResumeFile,
} from "@/lib/resumeUpload";

interface ResumeOptionalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Chamado SEMPRE que o fluxo deve prosseguir para registrar o interesse —
   * tanto após upload bem-sucedido quanto ao pular/cancelar o anexo.
   */
  onContinue: () => void;
}

/**
 * Popup opcional de anexo de currículo, exibido antes de registrar
 * interesse em uma vaga quando o candidato ainda não tem currículo.
 * Anexar é opcional: o candidato pode pular e seguir mesmo assim.
 */
export function ResumeOptionalDialog({
  open,
  onOpenChange,
  onContinue,
}: ResumeOptionalDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<NativeFileInputHandle>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setUploading(false);
    setUploadError(null);
  };

  const handleFileChange = (e: { target: { files: FileList | null; value: string } }) => {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setFile(null);
      return;
    }
    const err = validateResumeFile(f);
    if (err) {
      toast.error(err);
      setFile(null);
      return;
    }
    setUploadError(null);
    setFile(f);
  };

  const handleSkip = () => {
    reset();
    onOpenChange(false);
    onContinue();
  };

  const handleAttachAndContinue = async () => {
    if (!user || !file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadResume(user.id, file);
      await queryClient.invalidateQueries({ queryKey: ["resume_versions", user.id] });
      await queryClient.invalidateQueries({ queryKey: ["has_resume", user.id] });
      toast.success("Currículo anexado!");
      reset();
      onOpenChange(false);
      onContinue();
    } catch (err: any) {
      console.error("[ResumeOptionalDialog] upload error", err);
      setUploadError(err?.message || "Erro ao enviar currículo.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (uploading) return;
        if (!next) {
          // Fechar (clique fora / X) = continuar sem currículo
          reset();
          onOpenChange(false);
          onContinue();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Quer anexar seu currículo?
          </DialogTitle>
          <DialogDescription>
            Anexar um currículo aumenta suas chances com o recrutador, mas é
            totalmente opcional — você pode seguir sem anexar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <NativeFileInput
            ref={inputRef}
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileChange}
            disabled={uploading}
          />

          {file ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2.5">
              <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-xs text-foreground truncate">
                {file.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={uploading}
                onClick={() => setFile(null)}
                aria-label="Remover currículo"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={uploading}
              onClick={() => inputRef.current?.open()}
            >
              <Paperclip className="h-4 w-4 mr-2" />
              Escolher arquivo (PDF, DOC, DOCX)
            </Button>
          )}

          {uploadError && (
            <p className="text-xs text-destructive">{uploadError}</p>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            disabled={uploading}
            onClick={handleSkip}
          >
            Continuar sem currículo
          </Button>
          <Button
            type="button"
            disabled={!file || uploading}
            onClick={handleAttachAndContinue}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...
              </>
            ) : (
              "Anexar e continuar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
