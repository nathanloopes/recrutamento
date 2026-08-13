import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Upload, CheckCircle, XCircle, Clock, Camera, ArrowLeft, AlertTriangle, X } from "lucide-react";
import { useDocumentRequest, useDocumentUploads, useUploadDocument, useCancelDocumentUpload } from "@/hooks/useDocuments";
import { useDocumentRealtime } from "@/hooks/useDocumentRealtime";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

import { useRef, useMemo, useState } from "react";
import { PageHelp } from "@/components/ui/page-help";
import { CandidateAsoCard } from "@/components/candidate/CandidateAsoCard";
import { NativeFileInput, type NativeFileInputHandle } from "@/components/ui/NativeFileInput";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toDocMetas, mergeDocMetas, isAsoDocName, type DocMeta } from "@/lib/docNames";
import { formatDateBR, ymdToLocalDate } from "@/lib/dateUtils";

const statusConfig: Record<string, { label: string; icon: any; className: string }> = {
  pending: { label: "Enviado para análise", icon: Clock, className: "bg-blue-500/10 text-blue-600" },
  approved: { label: "Aprovado", icon: CheckCircle, className: "bg-primary/10 text-primary" },
  rejected: { label: "Revisão necessária", icon: XCircle, className: "bg-orange-500/10 text-orange-600" },
};

export default function Documents() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  useDocumentRealtime();
  const { data: request, isLoading: loadingRequest } = useDocumentRequest(applicationId);
  const { data: uploads, isLoading: loadingUploads } = useDocumentUploads(request?.id, (request as any)?._all_request_ids);
  const { data: docSettings } = useGlobalSettings("documents");
  const uploadDoc = useUploadDocument();
  const cancelDoc = useCancelDocumentUpload();
  

  const maxAttempts = useMemo(() => {
    const val = docSettings?.find((s) => s.key === "max_upload_attempts")?.value;
    return Number(val) || 3;
  }, [docSettings]);

  const autoBlockExpired = useMemo(() => {
    const val = docSettings?.find((s) => s.key === "auto_block_if_expired")?.value;
    return val === true || val === "true";
  }, [docSettings]);

  // Build doc list with required/optional metadata.
  // Source-of-truth fallback for legacy entries: global_settings.required_documents
  const sourceMap = useMemo(() => {
    const raw = docSettings?.find((s) => s.key === "required_documents")?.value;
    return new Map(
      toDocMetas(raw).map((m) => [m.name, { required: m.required, description: m.description }]),
    );
  }, [docSettings]);

  const allDocs: DocMeta[] = useMemo(() => {
    if (!request) return [];
    const merged = mergeDocMetas(
      toDocMetas((request as any).documents_list),
      toDocMetas((request as any).custom_documents),
    );
    const enriched = merged.map((m) => {
      const src = sourceMap.get(m.name);
      return {
        name: m.name,
        required: m.required && (src?.required !== false),
        description: m.description || src?.description,
      };
    });
    // ASO tem fluxo dedicado (CandidateAsoCard + agendamento/laudo pela equipe):
    // nunca deve aparecer como documento anexável pelo candidato.
    const withoutAso = enriched.filter((m) => !isAsoDocName(m.name));
    // Required first, then alphabetical.
    return withoutAso.sort(
      (a, b) =>
        Number(b.required) - Number(a.required) ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
  }, [request, sourceMap]);

  if (loadingRequest) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="px-4 pt-6 text-center space-y-4">
        <p className="text-muted-foreground">Nenhum checklist de documentos encontrado para esta candidatura.</p>
        <Button variant="outline" onClick={() => navigate("/candidaturas")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
      </div>
    );
  }

  if (request.status === "cancelled" || (request as any).application_status === "desistente") {
    return (
      <div className="px-4 pt-6 text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto" />
        <p className="text-muted-foreground">
          {(request as any).application_status === "desistente"
            ? "Esta solicitação de documentos foi cancelada porque você desistiu da vaga."
            : "Esta solicitação de documentos foi cancelada."}
        </p>
        <Button variant="outline" onClick={() => navigate("/candidaturas")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
      </div>
    );
  }

  const deadlineRaw: string | null = (request as any).deadline_date ?? null;
  const deadlineDate = deadlineRaw ? (ymdToLocalDate(deadlineRaw) ?? new Date(deadlineRaw)) : null;
  const deadlineLabel = formatDateBR(deadlineRaw);
  const isExpired = deadlineDate ? deadlineDate < new Date() : false;
  const blocked = isExpired && autoBlockExpired;

  const daysRemaining = deadlineDate
    ? Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000)
    : null;

  const getUploadForDoc = (docType: string) =>
    (uploads || [])
      .filter((u: any) => u.document_type === docType)
      .sort((a: any, b: any) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())[0];

  const getUploadCount = (docType: string) =>
    (uploads || []).filter((u: any) => u.document_type === docType).length;

  // Progress counts ONLY required documents — optional don't gate completion.
  const requiredDocs = allDocs.filter((d) => d.required);
  const sentCount = requiredDocs.filter((d) => {
    const u = getUploadForDoc(d.name);
    return u && u.status !== "rejected";
  }).length;

  const progress = requiredDocs.length > 0 ? Math.round((sentCount / requiredDocs.length) * 100) : 0;

  return (
    <div className="px-4 pt-6 pb-24 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/candidaturas")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Documentos para Contratação
          </h1>
          <PageHelp />
          <p className="text-sm text-muted-foreground">Envie os documentos exigidos para sua contratação</p>
        </div>
      </div>


      {/* Deadline indicator */}
      {deadlineDate && (
        <Card className={isExpired && autoBlockExpired ? "border-destructive" : isExpired ? "border-destructive/50" : daysRemaining !== null && daysRemaining <= 2 ? "border-warning" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            {isExpired && autoBlockExpired ? (
              <>
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">Prazo expirado — envios bloqueados</p>
                  <p className="text-xs text-muted-foreground">Prazo encerrou em {deadlineLabel}</p>
                </div>
              </>
            ) : isExpired ? (
              <>
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">Prazo expirado</p>
                  <p className="text-xs text-muted-foreground">Prazo era {deadlineLabel}</p>
                </div>
              </>
            ) : (
              <>
                <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">
                    {daysRemaining === 0 ? "Último dia!" : daysRemaining === 1 ? "1 dia restante" : `${daysRemaining} dias restantes`}
                  </p>
                  <p className="text-xs text-muted-foreground">Prazo até {deadlineLabel}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-medium">{sentCount}/{requiredDocs.length}</span>
          </div>
          <Progress value={progress} className="h-2" />
          {allDocs.length > requiredDocs.length && (
            <p className="text-[11px] text-muted-foreground">
              {allDocs.length - requiredDocs.length} documento(s) opcional(is) não contam para o progresso.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Document list */}
      {loadingUploads ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {allDocs.map((doc) => (
            <DocumentCard
              key={doc.name}
              docType={doc.name}
              description={doc.description}
              required={doc.required}
              upload={getUploadForDoc(doc.name)}
              requestId={request.id}
              uploading={uploadDoc.isPending}
              cancelling={cancelDoc.isPending}
              blocked={!!blocked}
              blockedReason={isExpired && autoBlockExpired ? "deadline" : null}
              uploadCount={getUploadCount(doc.name)}
              maxAttempts={maxAttempts}
              deadlineDate={(request as any).deadline_date}
              onUpload={(file: File) =>
                uploadDoc.mutate({
                  requestId: request.id,
                  documentType: doc.name,
                  file,
                  deadlineDate: (request as any).deadline_date,
                })
              }
              onCancel={(upload: any) =>
                cancelDoc.mutate({
                  uploadId: upload.id,
                  requestId: request.id,
                  fileUrl: upload.file_url,
                  documentType: doc.name,
                })
              }
            />
          ))}
        </div>
      )}

      {/* ASO — Exame admissional (aparece quando agendado pelo franqueado) */}
      {applicationId && (
        <CandidateAsoCard
          applicationId={applicationId}
          candidateId={(request as any)?.candidate_id}
        />
      )}

      <div className="bg-muted/50 rounded-lg p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium">📋 Instruções:</p>
        <p>• Envie fotos legíveis, sem cortes ou reflexos</p>
        <p>• Documentos com frente e verso: envie ambos os lados</p>
        <p>• Arraste e solte arquivos diretamente nos cards abaixo</p>
        <p>• Formatos aceitos variam por documento (verifique cada item)</p>
      </div>
    </div>
  );
}

function DocumentCard({
  docType, description, required, upload, requestId, uploading, cancelling, onUpload, onCancel, blocked, blockedReason, uploadCount, maxAttempts, deadlineDate,
}: {
  docType: string;
  description?: string;
  required: boolean;
  upload: any;
  requestId: string;
  uploading: boolean;
  cancelling: boolean;
  onUpload: (file: File) => void;
  onCancel: (upload: any) => void;
  blocked: boolean;
  blockedReason?: "interview" | "deadline" | null;
  uploadCount: number;
  maxAttempts: number;
  deadlineDate?: string | null;
}) {
  const inputRef = useRef<NativeFileInputHandle>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const status = upload?.status || "none";
  const conf = statusConfig[status];
  const attemptsLeft = maxAttempts - uploadCount;
  const canUpload = !blocked && attemptsLeft > 0;

  const clearPreview = () => {
    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewFile(null);
    setPreviewUrl(null);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) {
      clearPreview();
      const url = URL.createObjectURL(file);
      setPreviewFile(file);
      setPreviewUrl(url);
    } else {
      onUpload(file);
    }
    e.target.value = "";
  };

  const handleConfirm = () => {
    if (previewFile) onUpload(previewFile);
    clearPreview();
  };

  const handleRetake = () => {
    clearPreview();
    inputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (canUpload) setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!canUpload) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) {
      clearPreview();
      const url = URL.createObjectURL(file);
      setPreviewFile(file);
      setPreviewUrl(url);
    } else {
      onUpload(file);
    }
  };

  return (
    <Card
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={isDragOver ? "ring-2 ring-primary border-primary" : ""}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{docType}</p>
              <Badge
                variant={required ? "default" : "outline"}
                className="text-[10px]"
              >
                {required ? "Obrigatório" : "Opcional"}
              </Badge>
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{description}</p>
            )}
            {upload ? (
              <Badge variant="secondary" className={`mt-1 text-[10px] ${conf?.className || ""}`}>
                {conf?.icon && <conf.icon className="h-3 w-3 mr-1" />}
                {conf?.label || "Enviado"}
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-1 text-[10px]">
                <Clock className="h-3 w-3 mr-1" /> Não enviado
              </Badge>
            )}
          </div>
          {(!upload || upload.status === "rejected") && (
            <span className="text-[10px] text-muted-foreground">
              {attemptsLeft > 0 ? `${attemptsLeft} tentativa(s)` : "Sem tentativas"}
            </span>
          )}
        </div>

        {upload?.status === "rejected" && upload.rejection_reason && (
          <div className="bg-destructive/10 rounded p-2 text-xs text-destructive">
            ❌ Motivo: {upload.rejection_reason}
          </div>
        )}

        {previewUrl && (
          <div className="space-y-3">
            <img src={previewUrl} alt="Preview do documento" className="w-full rounded-lg max-h-48 object-contain bg-muted" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={handleRetake} disabled={uploading}>
                <Camera className="h-4 w-4 mr-2" /> Tirar novamente
              </Button>
              <Button size="sm" variant="default" className="flex-1" onClick={handleConfirm} disabled={uploading}>
                <Upload className="h-4 w-4 mr-2" /> Enviar
              </Button>
            </div>
          </div>
        )}

        {upload && upload.status === "pending" && (
          <Button
            size="sm"
            variant="outline"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            disabled={cancelling}
            onClick={() => setConfirmCancel(true)}
          >
            <X className="h-4 w-4 mr-2" /> {cancelling ? "Cancelando..." : "Cancelar envio"}
          </Button>
        )}

        <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar envio</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja cancelar o envio de <strong>"{docType}"</strong>? O arquivo será removido e o documento voltará para pendente de envio.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  onCancel(upload);
                  setConfirmCancel(false);
                }}
              >
                Confirmar cancelamento
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {(!upload || upload.status === "rejected") && !previewUrl && (
          <Button
            size="sm"
            variant={upload?.status === "rejected" ? "destructive" : "default"}
            className="w-full"
            disabled={uploading || !canUpload}
            onClick={() => inputRef.current?.click()}
          >
            {blocked ? (
              "Prazo expirado"
            ) : attemptsLeft <= 0 ? (
              "Tentativas esgotadas"
            ) : upload?.status === "rejected" ? (
              <><Upload className="h-4 w-4 mr-2" /> Reenviar</>
            ) : (
              <><Camera className="h-4 w-4 mr-2" /> Enviar Documento</>
            )}
          </Button>
        )}

        <NativeFileInput
          ref={inputRef}
          accept="image/*,.pdf"
          onChange={handleFile}
        />
      </CardContent>
    </Card>
  );
}
