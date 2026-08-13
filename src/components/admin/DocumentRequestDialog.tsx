import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Plus, FolderOpen, Send, Calendar, MessageSquare, Lock, AlertTriangle } from "lucide-react";
import { useCreateDocumentRequest } from "@/hooks/useDocuments";
import { useSendNotification } from "@/hooks/useNotifications";
import { useInterviewApprovalGate } from "@/hooks/useInterviewApprovalGate";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateBR, dateToLocalYMD } from "@/lib/dateUtils";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface DocumentRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: any;
  unitJob: any;
}

export function DocumentRequestDialog({
  open,
  onOpenChange,
  application,
  unitJob,
}: DocumentRequestDialogProps) {
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [customDoc, setCustomDoc] = useState("");
  const [customDocs, setCustomDocs] = useState<string[]>([]);
  const [deadlineDays, setDeadlineDays] = useState(7);
  // Default docs preserve required/optional + gender_requirement metadata from settings.
  type GenderReq = "all" | "male" | "female";
  const [defaultDocs, setDefaultDocs] = useState<{ name: string; required: boolean; gender_requirement?: GenderReq }[]>([]);
  const [candidateGender, setCandidateGender] = useState<GenderReq | null>(null);
  const [loading, setLoading] = useState(false);
  // Existing request for this application (read-only mode when present).
  const [existingRequest, setExistingRequest] = useState<any | null>(null);

  const createRequest = useCreateDocumentRequest();
  const sendNotification = useSendNotification();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canEditChecklist = hasRole("admin") || hasRole("rh_franqueadora");
  const { data: interviewGate } = useInterviewApprovalGate(application?.id);
  const interviewBlocked = interviewGate?.approved !== true;

  const unitId = unitJob?.units?.id || unitJob?.unit_id;
  const jobId = unitJob?.jobs?.id || unitJob?.job_id;
  const jobTitle = unitJob?.jobs?.title || "Vaga";
  const candidateName = application?.profiles?.full_name || "Candidato";

  // Normalize: docs may be stored as plain strings OR rich DocMeta objects.
  const toDocName = (d: any): string =>
    typeof d === "string" ? d : (d && typeof d === "object" && d.name) ? String(d.name) : "";
  const toNameArray = (arr: any): string[] =>
    Array.isArray(arr) ? arr.map(toDocName).filter(Boolean) : [];
  const toMetaArray = (arr: any): { name: string; required: boolean; gender_requirement?: GenderReq }[] =>
    Array.isArray(arr)
      ? arr
          .map((d: any) => {
            const name = toDocName(d);
            if (!name) return null;
            const req = typeof d === "object" && d !== null && "required" in d ? (d as any).required : true;
            const gr = typeof d === "object" && d !== null && (d as any).gender_requirement
              ? String((d as any).gender_requirement) as GenderReq
              : "all";
            return { name, required: req !== false, gender_requirement: gr };
          })
          .filter(Boolean) as any
      : [];

  // Normalize candidate gender values: pt-br "masculino"/"feminino" and en variants → male/female.
  const normalizeGender = (g?: string | null): GenderReq | null => {
    if (!g) return null;
    const v = String(g).trim().toLowerCase();
    if (["m", "male", "masculino", "homem"].includes(v)) return "male";
    if (["f", "female", "feminino", "mulher"].includes(v)) return "female";
    return null;
  };

  // Load default docs from unit_policies, fallback to global_settings
  // Also check for existing document_request for this application
  useEffect(() => {
    if (!open || !unitId) return;
    (async () => {
      // Check if there's already a document_request for this application
      const { data: existingReq } = await supabase
        .from("document_requests")
        .select("id, documents_list, custom_documents, deadline_date, status, created_at")
        .eq("application_id", application?.id)
        .neq("status", "cancelled")
        .maybeSingle();

      setExistingRequest(existingReq || null);

      // Try unit_policies first
      const { data: policy } = await supabase
        .from("unit_policies" as any)
        .select("required_documents")
        .eq("unit_id", unitId)
        .maybeSingle();

      let docs: { name: string; required: boolean; gender_requirement?: GenderReq }[] = [];
      if (policy && Array.isArray((policy as any).required_documents) && (policy as any).required_documents.length > 0) {
        docs = toMetaArray((policy as any).required_documents);
      } else {
        // Fallback to global_settings documents.required_documents
        const { data: gs } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "documents")
          .eq("key", "required_documents")
          .maybeSingle();
        if (gs?.value && Array.isArray(gs.value) && gs.value.length > 0) {
          docs = toMetaArray(gs.value);
        } else {
          // Try legacy key
          const { data: gs2 } = await supabase
            .from("global_settings")
            .select("value")
            .eq("category", "units")
            .eq("key", "default_required_documents")
            .maybeSingle();
          if (gs2?.value && Array.isArray(gs2.value) && gs2.value.length > 0) {
            docs = toMetaArray(gs2.value);
          }
        }
      }

      // Merge role-specific docs from required_documents_by_role
      const { data: roleDocsGs } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "documents")
        .eq("key", "required_documents_by_role")
        .maybeSingle();
      if (roleDocsGs?.value && typeof roleDocsGs.value === "object" && !Array.isArray(roleDocsGs.value)) {
        const roleMap = roleDocsGs.value as Record<string, any[]>;
        const jobTitle = unitJob?.jobs?.title || "";
        const roleDocsRaw = roleMap[jobTitle] || roleMap[jobTitle.toLowerCase()] || [];
        const roleDocs = toMetaArray(roleDocsRaw);
        for (const rd of roleDocs) {
          if (!docs.find((d) => d.name === rd.name)) docs.push(rd);
        }
      }

      // Resolve candidate gender (candidates → candidate_profiles fallback)
      let gender: GenderReq | null = null;
      if (application?.candidate_id) {
        const { data: cand } = await supabase
          .from("candidates")
          .select("gender")
          .eq("id", application.candidate_id)
          .maybeSingle();
        gender = normalizeGender(cand?.gender);
        if (!gender) {
          const { data: prof } = await supabase
            .from("candidate_profiles")
            .select("gender")
            .eq("candidate_id", application.candidate_id)
            .maybeSingle();
          gender = normalizeGender(prof?.gender);
        }
      }
      setCandidateGender(gender);

      // Filter out docs restricted to the opposite gender.
      // If candidate gender is unknown, keep "all" docs only (skip gendered ones to avoid wrong checklist).
      const filtered = docs.filter((d) => {
        const gr = (d.gender_requirement || "all") as GenderReq;
        if (gr === "all") return true;
        if (!gender) return false;
        return gr === gender;
      });

      setDefaultDocs(filtered);
      const docNames = filtered.map((d) => d.name);

      if (existingReq) {
        // Pre-select docs from existing request
        const existingDocs = toNameArray((existingReq as any).documents_list);
        const existingCustom = toNameArray((existingReq as any).custom_documents);
        // Merge: all existing docs selected, plus any custom ones
        const allExisting = Array.from(new Set([...existingDocs, ...existingCustom]));
        const extraCustom = allExisting.filter((d) => !docNames.includes(d));
        setCustomDocs(extraCustom);
        setSelectedDocs(allExisting);
      } else {
        setSelectedDocs(docNames);
      }

      // Load deadline_days
      const { data: dd } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "documents")
        .eq("key", "deadline_days")
        .maybeSingle();
      if (dd?.value) setDeadlineDays(Number(dd.value) || 7);
    })();
  }, [open, unitId, application?.id]);

  const toggleDoc = (doc: string) => {
    setSelectedDocs((prev) =>
      prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]
    );
  };

  const addCustomDoc = () => {
    const name = customDoc.trim();
    if (!name || customDocs.includes(name) || selectedDocs.includes(name)) return;
    setCustomDocs((prev) => [...prev, name]);
    setSelectedDocs((prev) => [...prev, name]);
    setCustomDoc("");
  };

  const allDocs = [...selectedDocs];
  const deadlineDate = new Date();
  deadlineDate.setDate(deadlineDate.getDate() + deadlineDays);

  // Canonical copy for the single CANDIDATE_DOCUMENTS_REQUESTED notification
  const notificationTitle = "Documentos solicitados";
  const notificationBody =
    "Você está na etapa de envio de documentos. Acesse o app para enviar os arquivos solicitados.";
  const notificationPreview = notificationBody;

  const handleSubmit = async () => {
    if (existingRequest) {
      // Defesa em UI: dialog em modo somente leitura — nunca deve disparar.
      toast.error("Já existe uma solicitação de documentos enviada para este candidato.");
      return;
    }
    if (interviewBlocked) {
      toast.error("Aprove o candidato na entrevista antes de solicitar documentos.");
      return;
    }
    if (allDocs.length === 0) {
      toast.error("Selecione pelo menos um documento");
      return;
    }
    setLoading(true);
    try {
      // Build enriched payload preserving required/optional from defaults.
      // Custom docs default to required=true.
      const metaByName = new Map(defaultDocs.map((d) => [d.name, d.required]));
      const enrichedDocs = allDocs.map((name) => ({
        name,
        required: metaByName.has(name) ? metaByName.get(name)! : true,
      }));
      const created: any = await createRequest.mutateAsync({
        applicationId: application.id,
        candidateId: application.candidate_id,
        unitId,
        jobId,
        documentsList: enrichedDocs,
      });

      // SINGLE canonical event: CANDIDATE_DOCUMENTS_REQUESTED (event_type kept as
      // "documents_requested" for backwards compat with templates/routes).
      // - 5s debounce via dedupKey → blocks double-clicks and parallel triggers
      // - skipIfAlreadyDelivered → never re-notifies the same request_id
      // - channel "push" → in-app + native push; WhatsApp/Email handled by template fallback
      const requestId = String(created?.id ?? "");
      sendNotification.mutate({
        eventType: "documents_requested",
        recipientId: application.candidate_id,
        channel: "push",
        dedupWindowSeconds: 5,
        dedupKey: requestId
          ? `documents_requested:${application.candidate_id}:${requestId}`
          : undefined,
        skipIfAlreadyDelivered: requestId
          ? { matchPayloadKey: "request_id", matchPayloadValue: requestId }
          : undefined,
        payload: {
          candidate_name: candidateName,
          job_title: jobTitle,
          request_id: requestId,
          application_id: String(application.id),
          _title: notificationTitle,
          _body: notificationBody,
        },
      });

      qc.invalidateQueries({ queryKey: ["candidate_doc_progress"] });
      qc.invalidateQueries({ queryKey: ["candidate_doc_requests"] });
      toast.success(`Documentos solicitados para ${candidateName}`);
      onOpenChange(false);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("DOCUMENT_REQUEST_ALREADY_EXISTS") || msg.includes("DOCUMENT_REQUEST_IMMUTABLE")) {
        toast.error("Já existe uma solicitação de documentos enviada para este candidato.");
        // Refletir o estado real no dialog (vira read-only no próximo open).
        qc.invalidateQueries({ queryKey: ["document_request"] });
        qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
        onOpenChange(false);
      } else if (msg.includes("INTERVIEW_NOT_APPROVED")) {
        toast.error("A solicitação de documentos só pode ocorrer após aprovação da entrevista.");
      } else {
        toast.error(msg || "Erro ao solicitar documentos");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            {existingRequest ? "Documentos solicitados" : "Solicitar Documentos"}
          </DialogTitle>
          <DialogDescription>
            {existingRequest
              ? `Visualização do checklist enviado para ${candidateName}.`
              : `Selecione os documentos obrigatórios para ${candidateName}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Already-sent banner — read-only mode */}
          {existingRequest && (
            <div className="rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-900/20 p-3 flex items-start gap-2">
              <Lock className="h-4 w-4 text-blue-700 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                  Solicitação já enviada
                </p>
                <p className="text-[11px] text-blue-700 dark:text-blue-400">
                  Enviada em {new Date(existingRequest.created_at).toLocaleDateString("pt-BR")}.
                  O checklist é imutável — para reabrir, é necessário cancelar a solicitação atual.
                </p>
              </div>
            </div>
          )}

          {/* Interview approval gate */}
          {!existingRequest && interviewBlocked && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-700 dark:text-yellow-400 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-300">
                  Solicitação bloqueada
                </p>
                <p className="text-[11px] text-yellow-700 dark:text-yellow-400">
                  Os documentos só podem ser solicitados após o candidato ser aprovado na entrevista.
                </p>
              </div>
            </div>
          )}

          {/* Read-only checklist banner for franchisee */}
          {!existingRequest && !canEditChecklist && (defaultDocs.length > 0 || customDocs.length > 0) && (
            <div className="rounded-lg border border-muted bg-muted/30 p-3 flex items-start gap-2">
              <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground">
                O checklist de documentos é definido pela Sede e não pode ser alterado pela unidade.
              </p>
            </div>
          )}

          {/* Checklist */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Documentos obrigatórios</Label>
            {defaultDocs.length === 0 && customDocs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {canEditChecklist
                  ? <>Nenhum checklist padrão configurado. Configure na aba <strong>"Checklist Padrão"</strong> do módulo Documentação ou adicione documentos manualmente abaixo.</>
                  : "Nenhum checklist padrão configurado pela Sede. Solicite à Sede para configurar antes de prosseguir."}
              </p>
            )}
            {defaultDocs.map((doc) => {
              const editable = canEditChecklist && !existingRequest;
              return (
                <label key={doc.name} className={`flex items-center gap-2 text-sm ${editable ? "cursor-pointer" : "cursor-default"}`}>
                  <Checkbox
                    checked={selectedDocs.includes(doc.name)}
                    onCheckedChange={() => editable && toggleDoc(doc.name)}
                    disabled={!editable}
                  />
                  <span className="flex-1">{doc.name}</span>
                  <Badge
                    variant={doc.required ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {doc.required ? "Obrigatório" : "Opcional"}
                  </Badge>
                </label>
              );
            })}
            {customDocs.map((doc) => {
              const editable = canEditChecklist && !existingRequest;
              return (
                <label key={doc} className={`flex items-center gap-2 text-sm ${editable ? "cursor-pointer" : "cursor-default"}`}>
                  <Checkbox
                    checked={selectedDocs.includes(doc)}
                    onCheckedChange={() => editable && toggleDoc(doc)}
                    disabled={!editable}
                  />
                  {doc}
                  <Badge variant="outline" className="text-[10px]">Custom</Badge>
                </label>
              );
            })}
          </div>

          {/* Add custom doc — admin only, hidden in read-only mode */}
          {canEditChecklist && !existingRequest && (
            <div className="flex gap-2">
              <Input
                placeholder="Adicionar documento extra..."
                value={customDoc}
                onChange={(e) => setCustomDoc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomDoc())}
                className="text-sm"
              />
              <Button variant="outline" size="sm" onClick={addCustomDoc} disabled={!customDoc.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}

          <Separator />

          {/* Deadline — editor (novo) ou leitura (existente) */}
          {existingRequest ? (
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Prazo</Label>
                <p className="text-sm">
                  {existingRequest.deadline_date
                    ? formatDateBR(existingRequest.deadline_date)
                    : "—"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Prazo (dias)</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(Number(e.target.value) || 7)}
                  className="w-20 text-sm h-8"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                Vence em {formatDateBR(dateToLocalYMD(deadlineDate))}
              </span>
            </div>
          )}

          {!existingRequest && <Separator />}

          {/* Notification preview — apenas no fluxo de envio */}
          {!existingRequest && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" /> Preview da notificação
              </Label>
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-foreground">
                <p className="font-medium mb-1">Documentos solicitados</p>
                <p>{notificationPreview}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {existingRequest ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={loading || allDocs.length === 0 || interviewBlocked}>
                <Send className="h-4 w-4 mr-2" />
                {interviewBlocked
                  ? "Aguardando aprovação da entrevista"
                  : loading ? "Enviando..." : `Solicitar ${allDocs.length} documento(s)`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
