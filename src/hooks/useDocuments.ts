import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCreateMigration } from "@/hooks/useMigration";
import { insertDocumentLog } from "@/hooks/useDocumentLogs";
import { sendPushToDevice } from "@/hooks/useNotifications";
import { getAdminRecipientIds } from "@/lib/notificationRoutes";
import { toDocNames, toDocMetas, mergeDocMetas, type DocMeta } from "@/lib/docNames";
import { ensureFreshSession, isAuthOrRlsError, SessionExpiredError } from "@/lib/session";
import { getStorageClient } from "@/lib/storageDirect";

// Candidate: list ALL document requests for logged-in user
export function useMyDocumentRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_document_requests", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_requests")
        .select("*, applications!inner(status, unit_job_id, unit_jobs:unit_job_id(job_id, unit_id, jobs:job_id(title), units:unit_id(name)))")
        .eq("candidate_id", user!.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Filter out requests whose application has been withdrawn
      const filteredData = (data || []).filter((r: any) => {
        const appStatus = r.applications?.status;
        return appStatus !== "desistente";
      });

      // Fetch upload details per request to compute analysis stats
      const ids = filteredData.map((r: any) => r.id);

      // Build required-doc map per request from its checklist metadata.
      const requiredByReq: Record<string, Set<string>> = {};
      for (const r of filteredData) {
        const metas = mergeDocMetas(
          toDocMetas((r as any).documents_list),
          toDocMetas((r as any).custom_documents),
        );
        requiredByReq[r.id] = new Set(metas.filter((m) => m.required).map((m) => m.name));
      }

      const requestStats: Record<string, { uploaded_count: number; pending_count: number; approved_count: number; rejected_count: number; required_total: number; required_uploaded: number }> = {};
      if (ids.length > 0) {
        const { data: uploads } = await supabase
          .from("document_uploads")
          .select("request_id, document_type, status, uploaded_at")
          .in("request_id", ids)
          .order("uploaded_at", { ascending: false });

        // Group by request_id → document_type, keep only latest upload per type
        const latestByType: Record<string, Record<string, any>> = {};
        for (const u of (uploads || []) as any[]) {
          if (!latestByType[u.request_id]) latestByType[u.request_id] = {};
          if (!latestByType[u.request_id][u.document_type]) {
            latestByType[u.request_id][u.document_type] = u; // already sorted desc
          }
        }

        for (const [reqId, types] of Object.entries(latestByType)) {
          const stats = { uploaded_count: 0, pending_count: 0, approved_count: 0, rejected_count: 0, required_total: 0, required_uploaded: 0 };
          const requiredSet = requiredByReq[reqId] || new Set<string>();
          for (const [docType, upload] of Object.entries(types)) {
            if (upload.status === "rejected") {
              stats.rejected_count++;
            } else {
              stats.uploaded_count++;
              if (upload.status === "pending") stats.pending_count++;
              else if (upload.status === "approved") stats.approved_count++;
              if (requiredSet.has(docType)) stats.required_uploaded++;
            }
          }
          requestStats[reqId] = stats;
        }
      }

      return filteredData.map((r: any) => {
        const uj = r.applications?.unit_jobs;
        const requiredSet = requiredByReq[r.id] || new Set<string>();
        const base = requestStats[r.id] || { uploaded_count: 0, pending_count: 0, approved_count: 0, rejected_count: 0, required_total: 0, required_uploaded: 0 };
        return {
          ...r,
          job_title: uj?.jobs?.title || "Vaga",
          unit_name: uj?.units?.name || "Unidade",
          uploaded_count: base.uploaded_count,
          pending_count: base.pending_count,
          approved_count: base.approved_count,
          rejected_count: base.rejected_count,
          required_total: requiredSet.size,
          required_uploaded: base.required_uploaded,
        };
      });
    },
  });
}

// Candidate: get document request for an application (merges duplicates)
export function useDocumentRequest(applicationId?: string) {
  return useQuery({
    queryKey: ["document_request", applicationId],
    enabled: !!applicationId,
    queryFn: async () => {
      let data: any[] = [];
      // Try by application_id first
      const { data: byApp, error } = await supabase
        .from("document_requests")
        .select("*, applications!inner(status, candidate_id)")
        .eq("application_id", applicationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      data = byApp || [];

      // Also include orphan requests (no application_id) for this candidate
      if (data.length > 0) {
        const candidateId = (data[0] as any).applications?.candidate_id;
        if (candidateId) {
          const { data: orphans } = await supabase
            .from("document_requests")
            .select("*, applications:application_id(status, candidate_id)")
            .eq("candidate_id", candidateId)
            .is("application_id", null)
            .order("created_at", { ascending: true });
          const existingIds = new Set(data.map((r: any) => r.id));
          for (const o of (orphans || [])) {
            if (!existingIds.has(o.id)) data.push(o);
          }
        }
      }

      if (data.length === 0) return null;

      // Merge all rows into a single logical request (dedup by name, keep required flag)
      const merged = { ...data[0] } as any;
      const docMetaList: DocMeta[] = [];
      const customMetaList: DocMeta[] = [];
      const allRequestIds: string[] = [];
      let isOpen = false;

      for (const row of data) {
        allRequestIds.push(row.id);
        if ((row as any).status !== "completed" && (row as any).status !== "cancelled") isOpen = true;
        docMetaList.push(...toDocMetas((row as any).documents_list));
        customMetaList.push(...toDocMetas((row as any).custom_documents));
      }

      merged.documents_list = mergeDocMetas(docMetaList);
      merged.custom_documents = mergeDocMetas(customMetaList);
      merged._all_request_ids = allRequestIds;
      if (isOpen && merged.status === "completed") merged.status = "open";
      merged.application_status = (data[0] as any).applications?.status;
      return merged;
    },
  });
}

// Candidate: list uploads for a request (supports multiple request_ids from merged duplicates)
export function useDocumentUploads(requestId?: string, allRequestIds?: string[]) {
  const ids = allRequestIds && allRequestIds.length > 0 ? allRequestIds : requestId ? [requestId] : [];
  return useQuery({
    queryKey: ["document_uploads", requestId, ...(allRequestIds || [])],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_uploads")
        .select("*")
        .in("request_id", ids)
        .order("uploaded_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

// Helper: get a document setting value
async function getDocSetting(key: string) {
  const { data } = await supabase
    .from("global_settings")
    .select("value")
    .eq("category", "documents")
    .eq("key", key)
    .maybeSingle();
  return data?.value;
}

// Comprime imagem no client via canvas até caber em maxSizeMb (mantém qualidade máxima possível)
async function compressImage(file: File, maxSizeMb: number): Promise<Blob> {
  const maxBytes = maxSizeMb * 1024 * 1024;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const MAX_DIM = 2400; // suficiente para leitura de documento
  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);

  const qualities = [0.85, 0.75, 0.65, 0.55, 0.45];
  for (const q of qualities) {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", q)
    );
    if (blob && blob.size <= maxBytes) return blob;
    if (blob && q === qualities[qualities.length - 1]) return blob;
  }
  return file;
}

/**
 * Marca o document_request como concluído quando TODOS os documentos obrigatórios
 * estão aprovados e, se `auto_close_on_complete` estiver ativo, move a application
 * para "aprovado". Compartilhado entre a validação do admin e o anexo do admin.
 */
async function tryAutoCompleteRequest(requestId: string, actorId?: string, candidateId?: string) {
  const { data: docReq } = await supabase
    .from("document_requests")
    .select("id, documents_list, custom_documents, application_id")
    .eq("id", requestId)
    .single();
  if (!docReq) return;

  const storedMetas = mergeDocMetas(
    toDocMetas(docReq.documents_list),
    toDocMetas(docReq.custom_documents),
  );
  const { data: globalDocs } = await supabase
    .from("global_settings")
    .select("value")
    .eq("category", "documents")
    .eq("key", "required_documents")
    .maybeSingle();
  const sourceMap = new Map(toDocMetas(globalDocs?.value).map((m) => [m.name, m.required]));
  const requiredDocs = storedMetas
    .filter((m) => {
      if (typeof (m as any).required === "boolean") return m.required;
      const src = sourceMap.get(m.name);
      return src !== false;
    })
    .map((m) => m.name);

  const { data: allUploads } = await supabase
    .from("document_uploads")
    .select("document_type, status")
    .eq("request_id", requestId);
  const uploadsByType: Record<string, string[]> = {};
  (allUploads || []).forEach((u: any) => {
    if (!uploadsByType[u.document_type]) uploadsByType[u.document_type] = [];
    uploadsByType[u.document_type].push(u.status);
  });

  const allApproved = requiredDocs.length > 0 && requiredDocs.every((doc: string) => uploadsByType[doc]?.includes("approved"));
  if (!allApproved) return;

  await supabase
    .from("document_requests")
    .update({ status: "completed" } as any)
    .eq("id", requestId);

  const autoClose = await getDocSetting("auto_close_on_complete");
  if ((autoClose === true || autoClose === "true") && docReq.application_id) {
    await supabase
      .from("applications")
      .update({ status: "aprovado" } as any)
      .eq("id", docReq.application_id)
      .in("status", ["em_andamento" as any]);

    await insertDocumentLog({
      candidate_id: candidateId,
      request_id: requestId,
      event: "auto_close_complete",
      actor_id: actorId,
      metadata: { auto_close_on_complete: true },
    });
  }
}

// Create document request (admin action when approving candidate)
export function useCreateDocumentRequest() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      applicationId,
      candidateId,
      unitId,
      jobId,
      documentsList,
    }: {
      applicationId: string;
      candidateId: string;
      unitId: string;
      jobId: string;
      // Accepts either legacy string[] or enriched ({name, required})[]
      documentsList: Array<string | { name: string; required?: boolean }>;
    }) => {
      // Read deadline_days setting
      const deadlineDays = Number(await getDocSetting("deadline_days")) || 7;
      const deadlineDate = new Date();
      deadlineDate.setDate(deadlineDate.getDate() + deadlineDays);

      // Item 8: enforce_global_documents — ensure institutional docs can't be removed
      const enforceGlobal = await getDocSetting("enforce_global_documents");
      const { data: globalDefaultDocs } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "documents")
        .eq("key", "required_documents")
        .maybeSingle();
      const institutionalMetas: DocMeta[] = (enforceGlobal === true || enforceGlobal === "true")
        ? toDocMetas(globalDefaultDocs?.value)
        : [];
      // Source-of-truth metadata for ALL known docs (used to inject `required`
      // flag even when caller passed plain strings).
      const sourceMetas: DocMeta[] = toDocMetas(globalDefaultDocs?.value);
      const sourceMap = new Map(sourceMetas.map((m) => [m.name, m]));

      const incomingMetas: DocMeta[] = toDocMetas(documentsList).map((m) => {
        // If caller passed a string, look up the institutional `required` flag.
        const src = sourceMap.get(m.name);
        if (src && typeof (m as any).required !== "boolean") {
          return { name: m.name, required: src.required };
        }
        return m;
      });
      // Merge required institutional docs (if enforced) + incoming selection.
      const mergedDocsMetas: DocMeta[] = mergeDocMetas(institutionalMetas, incomingMetas);

      // Bloqueio de duplicidade: 1 solicitação ativa por application.
      // Defesa em profundidade: o índice único parcial no banco
      // (ux_document_requests_active_per_application) também bloqueia race-condition.
      const { data: existing } = await supabase
        .from("document_requests")
        .select("id, status")
        .eq("application_id", applicationId)
        .neq("status", "cancelled")
        .maybeSingle();

      if (existing) {
        const err: any = new Error("DOCUMENT_REQUEST_ALREADY_EXISTS");
        err.code = "DOCUMENT_REQUEST_ALREADY_EXISTS";
        err.existingId = existing.id;
        throw err;
      }

      let data: any;
      {
        const { data: inserted, error } = await supabase
          .from("document_requests")
          .insert({
            application_id: applicationId,
            candidate_id: candidateId,
            unit_id: unitId,
            job_id: jobId,
            documents_list: mergedDocsMetas as any,
            deadline_date: deadlineDate.toISOString(),
          } as any)
          .select()
          .single();
        if (error) {
          // 23505 = unique_violation → outra requisição concorrente venceu a corrida
          if ((error as any).code === "23505") {
            const err: any = new Error("DOCUMENT_REQUEST_ALREADY_EXISTS");
            err.code = "DOCUMENT_REQUEST_ALREADY_EXISTS";
            throw err;
          }
          throw error;
        }
        data = inserted;

        await insertDocumentLog({
          candidate_id: candidateId,
          request_id: data.id,
          event: "checklist_criado",
          actor_id: user?.id,
          metadata: { documents_list: incomingMetas, deadline_date: deadlineDate.toISOString() },
        });
      }

      // NOTE: Notification dispatch is intentionally centralized in DocumentRequestDialog
      // via useSendNotification({ eventType: "documents_requested" }). Do NOT insert
      // notifications, dispatch automation events, or call send-whatsapp/send-email here —
      // doing so causes duplicate alerts. The single canonical event handles all channels
      // with dedup_key (5s window) and "already delivered" guard.
      return { ...data, _candidateId: candidateId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document_request"] });
      qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao criar checklist", description: e.message, variant: "destructive" });
    },
  });
}

// Candidate: upload a document
export function useUploadDocument() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      requestId,
      documentType,
      file,
      deadlineDate,
    }: {
      requestId: string;
      documentType: string;
      file: File;
      deadlineDate?: string | null;
    }) => {
      // Check auto_block_if_expired
      const autoBlock = await getDocSetting("auto_block_if_expired");
      if ((autoBlock === true || autoBlock === "true") && deadlineDate) {
        if (new Date(deadlineDate) < new Date()) {
          throw new Error("Prazo expirado. Não é possível enviar documentos após a data limite.");
        }
      }

      // Check max_upload_attempts
      const maxAttempts = Number(await getDocSetting("max_upload_attempts")) || 3;
      const { count } = await supabase
        .from("document_uploads")
        .select("id", { count: "exact", head: true })
        .eq("request_id", requestId)
        .eq("document_type", documentType)
        .eq("candidate_id", user!.id);
      if ((count || 0) >= maxAttempts) {
        throw new Error(`Máximo de ${maxAttempts} tentativas de upload atingido para este documento.`);
      }

      // Per-document format/size validation
      const requiredDocsRaw = await getDocSetting("required_documents");
      const docMetaList: any[] = Array.isArray(requiredDocsRaw)
        ? requiredDocsRaw.map((d: any) => typeof d === "string" ? { name: d, format: "", max_size_mb: 0 } : d)
        : [];
      const docMeta = docMetaList.find((d: any) => d.name === documentType);

      // Resolve a extensão de forma robusta: fotos da câmera muitas vezes chegam
      // sem extensão válida no nome (ou com nome genérico). Nesses casos usamos o
      // MIME type — mesmo comportamento tolerante do upload de avatar.
      const MIME_EXT: Record<string, string> = {
        "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
        "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
        "application/pdf": "pdf",
      };
      const nameExt = file.name.includes(".") ? (file.name.split(".").pop() || "").toLowerCase() : "";
      const mimeExt = MIME_EXT[(file.type || "").toLowerCase()] || "";
      const ext = mimeExt || nameExt || "jpg";

      // Validate format per document (fallback to global)
      if (docMeta?.format) {
        const allowedFormats = docMeta.format.split(",").map((f: string) => f.trim().toLowerCase()).filter(Boolean);
        if (allowedFormats.length > 0 && !allowedFormats.includes(ext)) {
          throw new Error(`Formato "${ext}" não aceito para "${documentType}". Formatos aceitos: ${allowedFormats.join(", ")}`);
        }
      } else {
        const globalFormats = await getDocSetting("document_accepted_formats");
        // Fotos sempre permitidas (mesmo comportamento tolerante do avatar): a UI
        // oferece explicitamente "tirar foto"/"anexar foto". Restrições explícitas
        // por documento (docMeta.format) continuam sendo respeitadas acima.
        const fileIsImage = /^image\//i.test(file.type || "") || /^(jpe?g|png|webp|heic|heif)$/i.test(ext);
        if (!fileIsImage && Array.isArray(globalFormats) && globalFormats.length > 0) {
          if (!globalFormats.map((f: string) => f.toLowerCase()).includes(ext)) {
            throw new Error(`Formato "${ext}" não aceito. Formatos aceitos: ${globalFormats.join(", ")}`);
          }
        }
      }

      // Validate size per document (fallback to global)
      const maxSizeMb = docMeta?.max_size_mb || Number(await getDocSetting("document_max_size_mb")) || 50;

      // Auto-compress images that exceed the limit (comum em foto de celular)
      let fileToUpload: File | Blob = file;
      const isImage = /^image\//i.test(file.type || "") || /^(jpe?g|png|webp|heic|heif)$/i.test(ext);
      if (isImage && file.size > maxSizeMb * 1024 * 1024) {
        try {
          fileToUpload = await compressImage(file, maxSizeMb);
        } catch (e) {
          console.warn("Falha ao comprimir imagem, seguindo com original:", e);
        }
      }
      if (fileToUpload.size > maxSizeMb * 1024 * 1024) {
        throw new Error(`Arquivo excede o tamanho máximo de ${maxSizeMb}MB para "${documentType}". Tente reduzir a resolução da foto ou envie um PDF menor.`);
      }

      const safeName = documentType
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "_");
      const path = `${user!.id}/${requestId}/${safeName}_${Date.now()}.${ext}`;

      // Guard 1: refresh JWT proactively BEFORE the potentially-long upload.
      // Without this, a token near expiry may die during a slow phone upload
      // and the follow-up INSERT would be rejected by RLS.
      try {
        await ensureFreshSession({ minTtlSeconds: 300 });
      } catch (e) {
        if (e instanceof SessionExpiredError) throw e;
        throw e;
      }

      const storageClient = await getStorageClient();
      const { error: uploadError } = await storageClient.storage
        .from("documents")
        .upload(path, fileToUpload, { contentType: (fileToUpload as any).type || file.type });
      if (uploadError) {
        const status = (uploadError as any)?.statusCode || (uploadError as any)?.status;
        if (status === 413 || String(status) === "413" || /payload too large|entity too large/i.test((uploadError as any)?.message || "")) {
          throw new Error(`O arquivo é muito grande para o servidor. Tente enviar uma versão de até ${maxSizeMb}MB (reduza a resolução da foto ou compacte o PDF).`);
        }
        throw uploadError;
      }

      // Guard 2: refresh JWT again right before the DB commit — the upload
      // itself may have taken minutes. Then commit the row through the
      // idempotent `register_document_upload` RPC.
      // If the commit fails because the session died in-flight, we refresh
      // once more and retry ONLY the DB write — we never re-upload. When
      // the retry still fails, we roll back by deleting the just-uploaded
      // file so nothing is left orphaned in Storage.
      const commitRow = async () => {
        return await supabase.rpc("register_document_upload", {
          p_request_id: requestId,
          p_document_type: documentType,
          p_file_url: path,
        } as any);
      };

      await ensureFreshSession({ minTtlSeconds: 60 });
      let { data: rpcData, error: rpcError } = await commitRow();

      if (rpcError && isAuthOrRlsError(rpcError)) {
        try {
          await supabase.auth.refreshSession();
        } catch {
          // ignore — the retry below will surface a clearer error
        }
        ({ data: rpcData, error: rpcError } = await commitRow());
      }

      if (rpcError || !rpcData) {
        // Roll back the storage object so we never leave orphans behind.
        try {
          const cleanupClient = await getStorageClient();
          await cleanupClient.storage.from("documents").remove([path]);
        } catch (cleanupErr) {
          console.warn("[useUploadDocument] falha ao remover arquivo órfão:", cleanupErr);
        }
        if (rpcError && isAuthOrRlsError(rpcError)) {
          throw new SessionExpiredError();
        }
        throw rpcError || new Error("Não foi possível registrar o documento. Tente novamente.");
      }

      const data: any = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (!data) throw new Error("Não foi possível registrar o documento. Tente novamente.");

      // Log
      await insertDocumentLog({
        candidate_id: user!.id,
        request_id: requestId,
        document_type: documentType,
        event: "upload",
        actor_id: user!.id,
        metadata: { file_url: path },
      });

      // Notify admin/franqueado/gestor da unidade — agrupado por candidatura (debounce 2 min)
      // via edge function `notify-document-uploaded` (service role faz dedupe seguro entre usuários).
      supabase.functions
        .invoke("notify-document-uploaded", {
          body: { request_id: requestId, document_type: documentType },
        })
        .catch((e) => console.warn("notify-document-uploaded failed:", e));

      // Gap 9: Fire-and-forget AI document validation
      try {
        const aiValidationEnabled = await getDocSetting("ai_document_validation_enabled");
        if (aiValidationEnabled === true || aiValidationEnabled === "true") {
          supabase.functions.invoke("validate-document-ai", {
            body: { upload_id: data.id },
          }).then(({ error: aiErr }) => {
            if (aiErr) console.warn("[useUploadDocument] AI validation error:", aiErr);
          }).catch((e) => {
            console.warn("[useUploadDocument] AI validation invoke error:", e);
          });
        }
      } catch (e) {
        console.warn("[useUploadDocument] AI validation check error:", e);
      }

      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["document_uploads", vars.requestId] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["candidate_documents"] });
      qc.invalidateQueries({ queryKey: ["candidate_doc_progress"] });
      toast({ title: "Documento enviado!" });
    },
    onError: (e: any) => {
      toast({ title: "Erro no upload", description: e.message, variant: "destructive" });
    },
  });
}

// Candidate: cancel (delete) a pending document upload
export function useCancelDocumentUpload() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      uploadId,
      requestId,
      fileUrl,
      documentType,
    }: {
      uploadId: string;
      requestId: string;
      fileUrl: string;
      documentType: string;
    }) => {
      // Use RPC function (SECURITY DEFINER) to bypass RLS
      const { data: result, error } = await supabase
        .rpc("cancel_pending_upload", { p_upload_id: uploadId } as any);
      if (error) throw error;
      const res = result as any;
      if (!res?.success) {
        throw new Error(res?.error || "Não foi possível cancelar o envio.");
      }

      // Delete storage file after DB record is confirmed deleted
      const cancelStorage = await getStorageClient();
      await cancelStorage.storage.from("documents").remove([fileUrl]);

      // Log
      await insertDocumentLog({
        candidate_id: user!.id,
        request_id: requestId,
        document_type: documentType,
        event: "upload_cancelado",
        actor_id: user!.id,
        metadata: { file_url: fileUrl },
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["document_uploads", vars.requestId] });
      qc.invalidateQueries({ queryKey: ["my_document_requests"] });
      qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
      qc.invalidateQueries({ queryKey: ["candidate_documents"] });
      qc.invalidateQueries({ queryKey: ["candidate_doc_progress"] });
      qc.invalidateQueries({ queryKey: ["document_request"] });
      toast({ title: "Envio cancelado", description: "Você pode reenviar o documento." });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao cancelar envio", description: e.message, variant: "destructive" });
    },
  });
}

// Admin: validate (approve/reject) a document
export function useValidateDocument() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      uploadId,
      status,
      rejectionReason,
      notes,
      requestId,
    }: {
      uploadId: string;
      status: "approved" | "rejected";
      rejectionReason?: string;
      notes?: string;
      requestId: string;
    }) => {
      const updates: any = {
        status,
        validated_at: new Date().toISOString(),
        validated_by: user!.id,
      };
      if (status === "rejected" && rejectionReason) {
        updates.rejection_reason = rejectionReason;
      }
      if (notes) {
        updates.notes = notes;
      }
      const { error } = await supabase
        .from("document_uploads")
        .update(updates)
        .eq("id", uploadId);
      if (error) throw error;

      // Get upload details for log
      const { data: upload } = await supabase
        .from("document_uploads")
        .select("candidate_id, document_type")
        .eq("id", uploadId)
        .single();

      // Document log
      await insertDocumentLog({
        candidate_id: upload?.candidate_id,
        request_id: requestId,
        document_type: upload?.document_type,
        event: status === "approved" ? "aprovado" : "rejeitado",
        actor_id: user?.id,
        metadata: status === "rejected" ? { rejection_reason: rejectionReason } : {},
      });

      // Auto-complete document_requests when ALL required docs are approved
      if (status === "approved") {
        await tryAutoCompleteRequest(requestId, user?.id, upload?.candidate_id);
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["document_uploads", vars.requestId] });
      qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
      qc.invalidateQueries({ queryKey: ["document_logs"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["hiring_audit_metrics"] });
      // Reflect doc validation immediately across recruiter/candidate views
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["candidate_doc_progress"] });
      qc.invalidateQueries({ queryKey: ["candidate_doc_requests"] });
      qc.invalidateQueries({ queryKey: ["candidate_timeline"] });
      qc.invalidateQueries({ queryKey: ["unit_job_detail"] });
      qc.invalidateQueries({ queryKey: ["existing_doc_request"] });
      qc.invalidateQueries({ queryKey: ["application_docs_pending"] });
      toast({ title: `Documento ${vars.status === "approved" ? "aprovado" : "necessita revisão"}` });

      // Audit log
      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: vars.status === "approved" ? "documento_aprovado" : "documento_rejeitado",
        module: "documentos",
        details: { upload_id: vars.uploadId, status: vars.status },
      } as any).then(() => {});

      // Send WhatsApp notification on rejection
      if (vars.status === "rejected") {
        (async () => {
          try {
            const { data: upload } = await supabase
              .from("document_uploads")
              .select("candidate_id, document_type")
              .eq("id", vars.uploadId)
              .single();
            if (upload?.candidate_id) {
              // Push notification for rejection
              const rejTitle = "Documento necessita revisão";
              const rejBody = `Seu documento "${upload.document_type}" precisa ser reenviado.${vars.rejectionReason ? ` Motivo: ${vars.rejectionReason}` : ""}`;
              supabase.from("notifications" as any).insert({
                event_type: "document_rejected",
                recipient_id: upload.candidate_id,
                channel: "push",
                title: rejTitle,
                body: rejBody,
                status: "pending",
                action_url: `/documentos`,
                action_type: "action_required",
              } as any).then(() => {});

              // WhatsApp
              (async () => {
                try {
                  const { data: rejProfile } = await supabase
                    .from("profiles")
                    .select("phone")
                    .eq("id", upload.candidate_id)
                    .single();
                  if (rejProfile?.phone) {
                    supabase.functions.invoke("send-whatsapp", {
                      body: {
                        phone: rejProfile.phone,
                        message: `📄 ${rejTitle}: ${rejBody}`,
                      },
                    }).catch((err) => console.warn("[WhatsApp] document_rejected failed:", err));
                  }
                } catch (e) {
                  console.warn("[WhatsApp] document_rejected lookup failed:", e);
                }
              })();
            }
          } catch (e) {
            console.warn("Failed to send rejection notifications:", e);
          }
        })();
      }
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

// Admin: list all document requests with filters
export function useAdminDocumentRequests() {
  const { hasRole, unitIds, profileLoaded } = useAuth();
  const isGlobalAdmin = hasRole("admin") || hasRole("rh_franqueadora");
  const hasScopedDocumentAccess = hasRole("franqueado") || hasRole("gestor_recrutamento");
  const scopedUnitIds = Array.from(new Set((unitIds || []).filter(Boolean)));

  return useQuery({
    queryKey: ["admin_document_requests", isGlobalAdmin ? "global" : scopedUnitIds.join("|")],
    enabled: profileLoaded && (isGlobalAdmin || !hasScopedDocumentAccess || scopedUnitIds.length > 0),
    queryFn: async () => {
      let query = supabase
        .from("document_requests")
        .select("*, profiles:candidate_id(full_name, email, phone), units:unit_id(name), jobs:job_id(title)")
        .order("created_at", { ascending: false });

      if (!isGlobalAdmin && hasScopedDocumentAccess) {
        query = query.in("unit_id", scopedUnitIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      const ids = (data || []).map((r: any) => r.id);
      if (ids.length === 0) return data || [];

      // Fetch upload summaries per request
      const { data: uploads } = await supabase
        .from("document_uploads")
        .select("request_id, status")
        .in("request_id", ids);

      const statsMap: Record<string, { pending: number; approved: number; rejected: number; total: number }> = {};
      for (const u of (uploads || []) as any[]) {
        if (!statsMap[u.request_id]) statsMap[u.request_id] = { pending: 0, approved: 0, rejected: 0, total: 0 };
        statsMap[u.request_id].total++;
        if (u.status === "pending") statsMap[u.request_id].pending++;
        else if (u.status === "approved") statsMap[u.request_id].approved++;
        else if (u.status === "rejected") statsMap[u.request_id].rejected++;
      }

      return (data || []).map((r: any) => ({
        ...r,
        _uploadStats: statsMap[r.id] || { pending: 0, approved: 0, rejected: 0, total: 0 },
      }));
    },
  });
}

// Admin: complete hiring
export function useCompleteHiring() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const createMigration = useCreateMigration();

  return useMutation({
    mutationFn: async ({
      applicationId,
      requestId,
    }: {
      applicationId: string;
      requestId: string;
    }) => {
      // Gap 1 fix: Check auto_migrate_enabled from CrossConfig
      const { isAutoMigrateEnabled } = await import("@/hooks/useMigration");
      const autoMigrateEnabled = await isAutoMigrateEnabled();
      const { error: appErr } = await supabase
        .from("applications")
        .update({ status: "contratado" } as any)
        .eq("id", applicationId);
      if (appErr) throw appErr;

      // Dispatch automation event: process_closed (contratado)
      const { dispatchAutomationEvent: dispatchAuto } = await import("@/lib/automationEngine");
      dispatchAuto("process_closed", {
        application_id: applicationId,
        status: "contratado",
      }).catch(() => {});

      const { error: reqErr } = await supabase
        .from("document_requests")
        .update({ status: "completed", completed_at: new Date().toISOString() } as any)
        .eq("id", requestId);
      if (reqErr) throw reqErr;

      const { data: app } = await supabase
        .from("applications")
        .select("candidate_id, unit_job_id, unit_jobs:unit_job_id(unit_id, job_id)")
        .eq("id", applicationId)
        .single();

      if (app && autoMigrateEnabled) {
        const uj = (app as any).unit_jobs;
        await createMigration.mutateAsync({
          candidateId: app.candidate_id,
          applicationId,
          unitId: uj?.unit_id,
          jobId: uj?.job_id,
          triggeredBy: user?.id,
        });
      }

      // Log
      await insertDocumentLog({
        candidate_id: app?.candidate_id,
        request_id: requestId,
        event: "contratacao_finalizada",
        actor_id: user?.id,
      });

      return { candidateId: app?.candidate_id, applicationId };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
      qc.invalidateQueries({ queryKey: ["my_applications"] });
      toast({ title: "Contratação finalizada com sucesso!" });

      // Notify candidate about hiring
      if (result?.candidateId) {
        const title = "Parabéns! Você foi contratado(a)!";
        const body = "Sua contratação foi finalizada. Bem-vindo(a) à equipe!";
        supabase.from("notifications" as any).insert({
          event_type: "hiring_completed",
          recipient_id: result.candidateId,
          channel: "push",
          title,
          body,
          status: "pending",
          action_url: "/candidaturas",
          action_type: "info",
          payload: { application_id: result.applicationId },
        } as any).then(() => {
          sendPushToDevice({
            recipientId: result.candidateId,
            title,
            body,
            actionUrl: "/candidaturas",
          }).catch((err) => console.error("[PUSH] hiring_completed push failed:", err));
        });

        // Send Email + WhatsApp for hiring completion
        (async () => {
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("phone, email, full_name")
              .eq("id", result.candidateId)
              .single();
            if (profile?.email) {
              supabase.functions.invoke("send-email", {
                body: {
                  to_email: profile.email,
                  to_name: profile.full_name || "Candidato",
                  subject: title,
                  html_content: `<p>Olá ${profile.full_name || ""},</p><p>${body}</p><p>Estamos felizes em ter você na equipe!</p>`,
                  text_content: `${body} Estamos felizes em ter você na equipe!`,
                },
              }).catch((err) => console.warn("[Email] hiring_completed failed:", err));
            }
            if (profile?.phone) {
              supabase.functions.invoke("send-whatsapp", {
                body: {
                  phone: profile.phone,
                  message: `🎉 ${title} ${body}`,
                },
              }).catch((err) => console.warn("[WhatsApp] hiring_completed failed:", err));
            }
          } catch (e) {
            console.warn("Failed to send hiring notifications:", e);
          }
        })();
      }

      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "contratacao_finalizada",
        module: "migracao",
        details: {},
      } as any).then(() => {});
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

// Admin: send approved documents to external emails (typed by the responsible)
export function useSendDocumentsExternal() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      requestId,
      destinationEmails,
    }: {
      requestId: string;
      destinationEmails: string[];
    }) => {
      const { data, error } = await supabase.functions.invoke("send-documents-external", {
        body: { requestId, destinationEmails },
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.success) {
        throw new Error(result?.error || "Falha no envio dos documentos");
      }
      return result as {
        success: boolean;
        messageId: string;
        documentsSent: number;
        deliveryMode: "attachment" | "signed_url";
        destinationEmails: string[];
      };
    },
    onSuccess: (result) => {
      const mode = result.deliveryMode === "attachment" ? "em anexo" : "via links";
      const count = result.destinationEmails?.length ?? 1;
      toast({
        title: "Documentação enviada com sucesso!",
        description: `${result.documentsSent} documento(s) enviado(s) ${mode} para ${count} destinatário(s)`,
      });
    },
    onError: (e: any) => {
      toast({
        title: "Erro ao enviar documentação",
        description: e.message,
        variant: "destructive",
      });
    },
  });
}

// Admin: add custom document to request
export function useAddCustomDocument() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      requestId,
      documentName,
      currentCustom,
    }: {
      requestId: string;
      documentName: string;
      currentCustom: string[];
    }) => {
      // Item 9: Check allow_unit_custom_docs before adding custom doc
      const allowCustom = await getDocSetting("allow_unit_custom_docs");
      if (allowCustom === false || allowCustom === "false") {
        throw new Error("Adição de documentos personalizados está desativada nas configurações globais.");
      }

      const updated = Array.from(new Set([...toDocNames(currentCustom), documentName]));
      const { error } = await supabase
        .from("document_requests")
        .update({ custom_documents: updated } as any)
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
      qc.invalidateQueries({ queryKey: ["document_request"] });
      toast({ title: "Documento adicionado ao checklist" });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

// Admin: anexa um documento em nome do candidato (já aprovado).
// Sobe o arquivo para o bucket `documents`, registra o upload como "approved"
// (validado pelo admin) e roda a auto-conclusão do checklist. Requer papel admin
// (políticas de RLS/storage em 20260723160000_admin_attach_documents.sql).
export function useAdminAttachDocument() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      requestId,
      candidateId,
      documentType,
      file,
    }: {
      requestId: string;
      candidateId: string;
      documentType: string;
      file: File;
      applicationId?: string;
    }) => {
      const MIME_EXT: Record<string, string> = {
        "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
        "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
        "application/pdf": "pdf",
      };
      const nameExt = file.name.includes(".") ? (file.name.split(".").pop() || "").toLowerCase() : "";
      const ext = MIME_EXT[(file.type || "").toLowerCase()] || nameExt || "pdf";
      const maxSizeMb = Number(await getDocSetting("document_max_size_mb")) || 50;

      // Comprime imagem grande (comum em foto de celular); demais formatos seguem como estão.
      let fileToUpload: File | Blob = file;
      const isImage = /^image\//i.test(file.type || "") || /^(jpe?g|png|webp|heic|heif)$/i.test(ext);
      if (isImage && file.size > maxSizeMb * 1024 * 1024) {
        try {
          fileToUpload = await compressImage(file, maxSizeMb);
        } catch (e) {
          console.warn("Falha ao comprimir imagem, seguindo com original:", e);
        }
      }
      if (fileToUpload.size > maxSizeMb * 1024 * 1024) {
        throw new Error(`Arquivo excede o tamanho máximo de ${maxSizeMb}MB.`);
      }

      const safeName = documentType
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "_");
      const path = `${candidateId}/${requestId}/admin_${safeName}_${Date.now()}.${ext}`;

      const attachStorage = await getStorageClient();
      const { error: uploadError } = await attachStorage.storage
        .from("documents")
        .upload(path, fileToUpload, { contentType: (fileToUpload as any).type || file.type });
      if (uploadError) throw uploadError;

      const { data: inserted, error: insertError } = await supabase
        .from("document_uploads")
        .insert({
          request_id: requestId,
          candidate_id: candidateId,
          document_type: documentType,
          file_url: path,
          status: "approved",
          validated_by: user?.id ?? null,
          validated_at: new Date().toISOString(),
          notes: "Anexado pelo administrador",
        } as any)
        .select()
        .single();
      if (insertError || !inserted) {
        // Rollback: remove o arquivo recém-enviado para não deixar órfão.
        try { const rb = await getStorageClient(); await rb.storage.from("documents").remove([path]); } catch { /* ignore */ }
        throw insertError || new Error("Não foi possível registrar o documento.");
      }

      await insertDocumentLog({
        candidate_id: candidateId,
        request_id: requestId,
        document_type: documentType,
        event: "upload",
        actor_id: user?.id,
        metadata: { file_url: path, attached_by_admin: true },
      });
      await insertDocumentLog({
        candidate_id: candidateId,
        request_id: requestId,
        document_type: documentType,
        event: "aprovado",
        actor_id: user?.id,
        metadata: { attached_by_admin: true },
      });

      await tryAutoCompleteRequest(requestId, user?.id, candidateId);

      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "documento_anexado_admin",
        module: "documentos",
        details: { request_id: requestId, document_type: documentType },
      } as any).then(() => {});

      return inserted;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["document_uploads", vars.requestId] });
      qc.invalidateQueries({ queryKey: ["admin_document_requests"] });
      qc.invalidateQueries({ queryKey: ["document_logs"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["candidate_doc_progress"] });
      qc.invalidateQueries({ queryKey: ["candidate_doc_requests"] });
      qc.invalidateQueries({ queryKey: ["unit_job_detail"] });
      qc.invalidateQueries({ queryKey: ["application_docs_pending"] });
      qc.invalidateQueries({ queryKey: ["aso_scheduling_gate"] });
      toast({ title: "Documento anexado e aprovado" });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao anexar documento", description: e.message, variant: "destructive" });
    },
  });
}
