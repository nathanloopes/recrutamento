import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { useValidateDocument } from "@/hooks/useDocuments";
import { useSendNotification } from "@/hooks/useNotifications";
import { insertDocumentLog } from "@/hooks/useDocumentLogs";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_DOCUMENT_REJECTION_REASON } from "@/lib/userMessages";
import {
  FolderOpen,
  CheckCircle2,
  Clock,
  XCircle,
  Download,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Eye,
  X,
} from "lucide-react";
import { format } from "date-fns";

const DOC_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Revisão necessária",
};

const DOC_STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/20",
  approved: "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
};

function isImageFile(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url);
}

interface DocCheckItem {
  name: string;
  status: "pending" | "approved" | "rejected" | "missing";
  upload?: any; // document_uploads row
}

interface InlineDocumentReviewProps {
  docRequests: any[];
  documents: any[];
  candidateId: string;
  applicationId: string;
}

export function InlineDocumentReview({
  docRequests,
  documents,
  candidateId,
  applicationId,
}: InlineDocumentReviewProps) {
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveNotes, setApproveNotes] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [loadingUrls, setLoadingUrls] = useState<Record<string, string>>({});

  const validateDoc = useValidateDocument();
  const sendNotification = useSendNotification();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Live-refresh the recruiter view whenever the candidate uploads a new
  // document. Without this, a recently-committed row would only appear on
  // manual reload.
  useEffect(() => {
    if (!candidateId) return;
    const channel = supabase
      .channel(`document_uploads_${candidateId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "document_uploads",
          filter: `candidate_id=eq.${candidateId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
          qc.invalidateQueries({ queryKey: ["candidate_documents"] });
          qc.invalidateQueries({ queryKey: ["document_uploads"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [candidateId, qc]);

  // Build enriched checklist
  const checklist = buildEnrichedChecklist(docRequests, documents);

  // Group by prefix for frente/verso
  const grouped = groupByPrefix(checklist);

  const uploaded = checklist.filter((d) => d.status !== "missing").length;
  const total = checklist.length;
  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0;

  // Get a displayable/downloadable URL for a document.
  // Baixa o arquivo e cria um blob: URL local. Necessário porque os signed URLs
  // apontam para o host direto do Supabase (cross-origin) e o CSP da página
  // (img-src 'self' data: blob:) bloqueia <img> cross-origin. blob: é permitido.
  const getSignedUrl = async (fileUrl: string): Promise<string | null> => {
    if (loadingUrls[fileUrl]) return loadingUrls[fileUrl];
    const storage = await getStorageClient();
    const { data, error } = await storage.storage
      .from("documents")
      .download(fileUrl);
    if (error || !data) return null;
    const objectUrl = URL.createObjectURL(data);
    setLoadingUrls((prev) => ({ ...prev, [fileUrl]: objectUrl }));
    return objectUrl;
  };

  const handleDownload = async (fileUrl: string, docName: string) => {
    const url = await getSignedUrl(fileUrl);
    if (url) {
      const ext = fileUrl.includes(".") ? (fileUrl.split(".").pop() || "").toLowerCase() : "";
      const a = document.createElement("a");
      a.href = url;
      a.download = ext ? `${docName}.${ext}` : docName;
      a.click();
      // Log download event
      insertDocumentLog({
        candidate_id: candidateId,
        document_type: docName,
        event: "download",
        actor_id: user?.id,
        metadata: { file_url: fileUrl },
      });
    }
  };

  const handleDownloadAll = async () => {
    const docsWithFiles = checklist.filter((d) => d.upload?.file_url);
    for (const doc of docsWithFiles) {
      await handleDownload(doc.upload.file_url, doc.name);
    }
  };

  // Abre o documento numa nova aba (visualização). Usa blob: URL local para
  // funcionar sob o CSP e renderizar PDF/imagem no viewer do navegador.
  const handleOpen = async (fileUrl: string) => {
    const url = await getSignedUrl(fileUrl);
    if (url) {
      const w = window.open(url, "_blank");
      if (!w) window.location.href = url;
    }
  };

  const handleZoom = async (fileUrl: string, docName?: string) => {
    const url = await getSignedUrl(fileUrl);
    if (url) {
      setZoomUrl(url);
      // Log document_viewed event
      insertDocumentLog({
        candidate_id: candidateId,
        document_type: docName || "unknown",
        event: "document_viewed",
        actor_id: user?.id,
        metadata: { application_id: applicationId },
      });
    }
  };

  const handleApprove = (upload: any, notes?: string) => {
    validateDoc.mutate(
      { uploadId: upload.id, status: "approved", notes: notes || undefined, requestId: upload.request_id },
      {
        onSuccess: () => {
          sendNotification.mutate({
            recipientId: candidateId,
            eventType: "document_approved",
            payload: {
              application_id: applicationId,
              document_type: upload.document_type,
              _title: "Documento aprovado ✅",
              _body: `Seu documento ${upload.document_type || ""} foi aprovado com sucesso.`,
            },
          });
          qc.invalidateQueries({ queryKey: ["candidate_documents"] });
        },
      },
    );
  };

  const handleReject = (upload: any) => {
    if (!rejectReason.trim()) return;
    validateDoc.mutate(
      {
        uploadId: upload.id,
        status: "rejected",
        rejectionReason: rejectReason,
        requestId: upload.request_id,
      },
      {
        onSuccess: () => {
          // Send notification to candidate
          sendNotification.mutate({
            recipientId: candidateId,
            eventType: "document_rejected",
            payload: {
              application_id: applicationId,
              document_type: upload.document_type,
              rejection_reason: rejectReason,
              _title: "Documento necessita revisão ⚠️",
              _body: `Seu documento ${upload.document_type || ""} precisa de revisão. Motivo: ${rejectReason}`,
            },
          });
          setRejectingId(null);
          setRejectReason("");
          qc.invalidateQueries({ queryKey: ["candidate_documents"] });
        },
      },
    );
  };

  if (total === 0) {
    return (
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FolderOpen className="h-4 w-4 text-primary" /> Documentos
        </h3>
        <p className="text-sm text-muted-foreground">Nenhum documento solicitado.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FolderOpen className="h-4 w-4 text-primary" /> Documentos
        </h3>
        {uploaded > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleDownloadAll}
          >
            <Download className="h-3 w-3" /> Baixar Todos
          </Button>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Recebidos</span>
        <span className="font-medium text-foreground">
          {uploaded}/{total}
        </span>
      </div>
      <Progress value={percent} className="h-2" />

      {/* Document cards */}
      <div className="space-y-1.5">
        {grouped.map((group, gi) => (
          <div key={gi}>
            {group.items.length > 1 && (
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-2 mb-1">
                {group.prefix}
              </p>
            )}
            {group.items.map((item, i) => (
              <DocumentCard
                key={`${gi}-${i}`}
                item={item}
                isRejecting={rejectingId === item.upload?.id}
                isApproving={approvingId === item.upload?.id}
                rejectReason={rejectReason}
                approveNotes={approveNotes}
                onRejectReasonChange={setRejectReason}
                onApproveNotesChange={setApproveNotes}
                onStartReject={(id) => {
                  setRejectingId(id);
                  setRejectReason(DEFAULT_DOCUMENT_REJECTION_REASON);
                  setApprovingId(null);
                }}
                onCancelReject={() => {
                  setRejectingId(null);
                  setRejectReason("");
                }}
                onConfirmReject={() => item.upload && handleReject(item.upload)}
                onStartApprove={(id) => {
                  setApprovingId(id);
                  setApproveNotes("");
                  setRejectingId(null);
                }}
                onCancelApprove={() => {
                  setApprovingId(null);
                  setApproveNotes("");
                }}
                onConfirmApprove={() => {
                  if (item.upload) {
                    handleApprove(item.upload, approveNotes);
                    setApprovingId(null);
                    setApproveNotes("");
                  }
                }}
                onDownload={() =>
                  item.upload && handleDownload(item.upload.file_url, item.name)
                }
                onOpen={() => item.upload && handleOpen(item.upload.file_url)}
                onZoom={() => item.upload && handleZoom(item.upload.file_url, item.name)}
                isSubmitting={validateDoc.isPending}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Zoom Dialog */}
      <Dialog open={!!zoomUrl} onOpenChange={() => setZoomUrl(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-2">
          <DialogTitle className="sr-only">Visualizar documento</DialogTitle>
          <DialogDescription className="sr-only">Pré-visualização do documento em tamanho ampliado</DialogDescription>
          {zoomUrl && (
            <img
              src={zoomUrl}
              alt="Documento ampliado"
              className="w-full h-auto max-h-[85vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---- DocumentCard ----

function DocumentCard({
  item,
  isRejecting,
  isApproving,
  rejectReason,
  approveNotes,
  onRejectReasonChange,
  onApproveNotesChange,
  onStartReject,
  onCancelReject,
  onConfirmReject,
  onStartApprove,
  onCancelApprove,
  onConfirmApprove,
  onDownload,
  onOpen,
  onZoom,
  isSubmitting,
}: {
  item: DocCheckItem;
  isRejecting: boolean;
  isApproving: boolean;
  rejectReason: string;
  approveNotes: string;
  onRejectReasonChange: (v: string) => void;
  onApproveNotesChange: (v: string) => void;
  onStartReject: (id: string) => void;
  onCancelReject: () => void;
  onConfirmReject: () => void;
  onStartApprove: (id: string) => void;
  onCancelApprove: () => void;
  onConfirmApprove: () => void;
  onDownload: () => void;
  onOpen: () => void;
  onZoom: () => void;
  isSubmitting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasUpload = !!item.upload;
  const isImage = hasUpload && isImageFile(item.upload.file_url);

  const statusIcon =
    item.status === "approved" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
    ) : item.status === "pending" ? (
      <Clock className="h-3.5 w-3.5 text-warning shrink-0" />
    ) : item.status === "rejected" ? (
      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
    ) : (
      <Clock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
    );

  if (!hasUpload) {
    return (
      <div className="flex items-center justify-between text-xs rounded-md border border-dashed p-2">
        <span className="flex items-center gap-1.5 text-muted-foreground truncate max-w-[70%]">
          {statusIcon}
          {item.name}
        </span>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Não enviado
        </Badge>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full text-xs rounded-md border p-2 hover:bg-accent/50 transition-colors text-left">
          <span className="flex items-center gap-1.5 text-foreground truncate max-w-[55%]">
            {statusIcon}
            {item.name}
          </span>
          <span className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={`text-[10px] ${DOC_STATUS_COLORS[item.status] || ""}`}
            >
              {DOC_STATUS_LABELS[item.status] || item.status}
            </Badge>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border border-t-0 rounded-b-md p-2.5 space-y-2.5 bg-muted/30">
        {/* Preview row */}
        <div className="flex items-start gap-3">
          {isImage ? (
            <SignedThumbnail fileUrl={item.upload.file_url} onClick={onZoom} />
          ) : (
            <div className="flex items-center justify-center h-16 w-16 rounded bg-muted border shrink-0">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 space-y-1 min-w-0">
            <p className="text-[11px] text-muted-foreground">
              Enviado em{" "}
              {item.upload.uploaded_at
                ? format(new Date(item.upload.uploaded_at), "dd/MM/yyyy HH:mm")
                : "—"}
            </p>
            {item.status === "rejected" && item.upload.rejection_reason && (
              <p className="text-[11px] text-destructive">
                Motivo: {item.upload.rejection_reason}
              </p>
            )}
            {item.upload.notes && (
              <p className="text-[11px] text-muted-foreground">
                Obs: {item.upload.notes}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isImage && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onZoom}>
              <Eye className="h-3 w-3" /> Ver
            </Button>
          )}
          {!isImage && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onOpen}>
              <Eye className="h-3 w-3" /> Abrir
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onDownload}>
            <Download className="h-3 w-3" /> Baixar
          </Button>

          {item.status === "pending" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-success hover:text-success hover:bg-success/10"
                onClick={() => onStartApprove(item.upload.id)}
                disabled={isSubmitting}
              >
                <CheckCircle2 className="h-3 w-3" /> Aprovar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onStartReject(item.upload.id)}
                disabled={isSubmitting}
              >
                <XCircle className="h-3 w-3" /> Solicitar Revisão
              </Button>
            </>
          )}
        </div>

        {/* Inline approve with notes */}
        {isApproving && (
          <div className="space-y-1.5">
            <Textarea
              placeholder="Observações (opcional)..."
              value={approveNotes}
              onChange={(e) => onApproveNotesChange(e.target.value)}
              className="min-h-[50px] text-xs"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs bg-success hover:bg-success/90 text-success-foreground"
                onClick={onConfirmApprove}
                disabled={isSubmitting}
              >
                Confirmar aprovação
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancelApprove}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Inline reject input */}
        {isRejecting && (
          <div className="space-y-1.5">
            <Textarea
              placeholder="Motivo da rejeição..."
              value={rejectReason}
              onChange={(e) => onRejectReasonChange(e.target.value)}
              className="min-h-[60px] text-xs"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={onConfirmReject}
                disabled={!rejectReason.trim() || isSubmitting}
              >
                Confirmar rejeição
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancelReject}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---- SignedThumbnail ----

function SignedThumbnail({
  fileUrl,
  onClick,
}: {
  fileUrl: string;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  // Load a local blob: URL on mount (CSP bloqueia <img> cross-origin do Supabase).
  React.useEffect(() => {
    let objectUrl: string | null = null;
    (async () => {
      const storage = await getStorageClient();
      const { data, error } = await storage.storage
        .from("documents")
        .download(fileUrl);
      if (!error && data) {
        objectUrl = URL.createObjectURL(data);
        setSrc(objectUrl);
      }
    })();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl]);

  return (
    <button
      onClick={onClick}
      className="relative h-16 w-16 rounded border overflow-hidden bg-muted shrink-0 hover:ring-2 hover:ring-primary/50 transition-all"
    >
      {src ? (
        <img
          src={src}
          alt="Miniatura"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex items-center justify-center h-full w-full">
          <ImageIcon className="h-5 w-5 text-muted-foreground animate-pulse" />
        </div>
      )}
    </button>
  );
}

// ---- Helpers ----

function buildEnrichedChecklist(
  docRequests: any[],
  uploads: any[]
): DocCheckItem[] {
  const items: DocCheckItem[] = [];
  const norm = (s: any) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const uploadMap = new Map<string, any>();
  for (const u of uploads || []) {
    const key = norm(u.document_type);
    if (!key) continue;
    // Keep latest upload per type
    if (!uploadMap.has(key) || new Date(u.uploaded_at) > new Date(uploadMap.get(key).uploaded_at)) {
      uploadMap.set(key, u);
    }
  }

  // Deduplicate doc names across all requests
  const seenDocs = new Set<string>();
  for (const req of docRequests) {
    const docsList = Array.isArray(req.documents_list)
      ? req.documents_list
      : [];
    const customDocs = Array.isArray(req.custom_documents)
      ? req.custom_documents
      : [];
    const allDocs = [...docsList, ...customDocs];
    for (const docName of allDocs) {
      const name =
        typeof docName === "string"
          ? docName
          : (docName as any)?.name || "Documento";
      const key = norm(name);
      if (seenDocs.has(key)) continue;
      seenDocs.add(key);
      const upload = uploadMap.get(key);
      items.push({
        name,
        status: upload ? (upload.status as any) : "missing",
        upload: upload || undefined,
      });
    }
  }

  // Include uploads whose document_type doesn't match the checklist
  // (e.g. custom docs, orphans recovered by reconciliation). Without this,
  // a real file existing in the DB would be invisible to the recruiter.
  for (const [key, upload] of uploadMap.entries()) {
    if (seenDocs.has(key)) continue;
    seenDocs.add(key);
    items.push({
      name: upload.document_type || "Documento",
      status: (upload.status as any) || "pending",
      upload,
    });
  }
  return items;
}


interface DocGroup {
  prefix: string;
  items: DocCheckItem[];
}

function groupByPrefix(items: DocCheckItem[]): DocGroup[] {
  const groups: DocGroup[] = [];
  const seen = new Map<string, DocGroup>();

  for (const item of items) {
    // Try to extract prefix before " - " (e.g. "RG - Frente" → "RG")
    const dashIndex = item.name.indexOf(" - ");
    const prefix = dashIndex > 0 ? item.name.substring(0, dashIndex).trim() : null;

    if (prefix) {
      if (seen.has(prefix)) {
        seen.get(prefix)!.items.push(item);
      } else {
        const group: DocGroup = { prefix, items: [item] };
        seen.set(prefix, group);
        groups.push(group);
      }
    } else {
      groups.push({ prefix: item.name, items: [item] });
    }
  }
  return groups;
}
