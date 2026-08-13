import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCreateDocumentRequest } from "@/hooks/useDocuments";
import { useSendNotification } from "@/hooks/useNotifications";

/**
 * Cria a solicitação de documentos programaticamente, com a MESMA lógica do
 * botão "Solicitar N documento(s)" em DocumentRequestDialog: carrega defaults
 * (unit_policies → global_settings → legado), filtra por gênero, mescla docs
 * específicos por cargo, cria o document_request e dispara a notificação
 * canônica `documents_requested` (com dedup key idêntica ao dialog).
 *
 * Usado no gatilho automático "aprovar teste presencial → cria checklist".
 * O botão manual do dialog continua funcionando em paralelo — o índice único
 * `ux_document_requests_active_per_application` protege contra corrida.
 *
 * Retorna:
 *  - { created: true, requestId }       — checklist novo criado.
 *  - { created: false, alreadyExisted } — já existia; nada foi feito.
 */

type GenderReq = "all" | "male" | "female";
type DocMetaLite = { name: string; required: boolean; gender_requirement?: GenderReq };

function toDocName(d: any): string {
  return typeof d === "string" ? d : (d && typeof d === "object" && d.name) ? String(d.name) : "";
}

function toMetaArray(arr: any): DocMetaLite[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((d: any) => {
      const name = toDocName(d);
      if (!name) return null;
      const req = typeof d === "object" && d !== null && "required" in d ? (d as any).required : true;
      const gr = typeof d === "object" && d !== null && (d as any).gender_requirement
        ? String((d as any).gender_requirement) as GenderReq
        : "all";
      return { name, required: req !== false, gender_requirement: gr };
    })
    .filter(Boolean) as DocMetaLite[];
}

function normalizeGender(g?: string | null): GenderReq | null {
  if (!g) return null;
  const v = String(g).trim().toLowerCase();
  if (["m", "male", "masculino", "homem"].includes(v)) return "male";
  if (["f", "female", "feminino", "mulher"].includes(v)) return "female";
  return null;
}

async function loadDefaultDocsForApplication(params: {
  unitId: string;
  candidateId: string;
  jobTitle: string;
}): Promise<DocMetaLite[]> {
  const { unitId, candidateId, jobTitle } = params;

  // 1) unit_policies → 2) global_settings.documents.required_documents → 3) global_settings.units.default_required_documents (legado).
  let docs: DocMetaLite[] = [];
  const { data: policy } = await supabase
    .from("unit_policies" as any)
    .select("required_documents")
    .eq("unit_id", unitId)
    .maybeSingle();
  if (policy && Array.isArray((policy as any).required_documents) && (policy as any).required_documents.length > 0) {
    docs = toMetaArray((policy as any).required_documents);
  } else {
    const { data: gs } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "documents")
      .eq("key", "required_documents")
      .maybeSingle();
    if (gs?.value && Array.isArray(gs.value) && gs.value.length > 0) {
      docs = toMetaArray(gs.value);
    } else {
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

  // Docs por cargo (required_documents_by_role[jobTitle]).
  const { data: roleDocsGs } = await supabase
    .from("global_settings")
    .select("value")
    .eq("category", "documents")
    .eq("key", "required_documents_by_role")
    .maybeSingle();
  if (roleDocsGs?.value && typeof roleDocsGs.value === "object" && !Array.isArray(roleDocsGs.value)) {
    const roleMap = roleDocsGs.value as Record<string, any[]>;
    const roleDocsRaw = roleMap[jobTitle] || roleMap[jobTitle.toLowerCase()] || [];
    const roleDocs = toMetaArray(roleDocsRaw);
    for (const rd of roleDocs) if (!docs.find((d) => d.name === rd.name)) docs.push(rd);
  }

  // Gênero do candidato (candidates → candidate_profiles fallback).
  let gender: GenderReq | null = null;
  if (candidateId) {
    const { data: cand } = await supabase
      .from("candidates")
      .select("gender")
      .eq("id", candidateId)
      .maybeSingle();
    gender = normalizeGender(cand?.gender);
    if (!gender) {
      const { data: prof } = await supabase
        .from("candidate_profiles")
        .select("gender")
        .eq("candidate_id", candidateId)
        .maybeSingle();
      gender = normalizeGender(prof?.gender);
    }
  }

  return docs.filter((d) => {
    const gr = (d.gender_requirement || "all") as GenderReq;
    if (gr === "all") return true;
    if (!gender) return false;
    return gr === gender;
  });
}

export interface AutoRequestDocumentsInput {
  application: {
    id: string;
    candidate_id: string;
    profiles?: { full_name?: string | null } | null;
  };
  unitJob: {
    unit_id?: string;
    job_id?: string;
    units?: { id?: string; name?: string } | null;
    jobs?: { id?: string; title?: string } | null;
  };
}

export type AutoRequestDocumentsResult =
  | { created: true; requestId: string }
  | { created: false; alreadyExisted: true; existingId: string };

export function useAutoRequestDocuments() {
  const createRequest = useCreateDocumentRequest();
  const sendNotification = useSendNotification();

  return useMutation<AutoRequestDocumentsResult, Error, AutoRequestDocumentsInput>({
    mutationFn: async ({ application, unitJob }) => {
      const unitId = unitJob?.units?.id || unitJob?.unit_id || "";
      const jobId = unitJob?.jobs?.id || unitJob?.job_id || "";
      const jobTitle = unitJob?.jobs?.title || "Vaga";
      const candidateName = application?.profiles?.full_name || "Candidato";

      if (!unitId || !jobId) {
        throw new Error("Não foi possível identificar unidade/cargo da candidatura.");
      }

      // Duplicidade: já existe request ativo para essa application?
      const { data: existing } = await supabase
        .from("document_requests")
        .select("id, status")
        .eq("application_id", application.id)
        .neq("status", "cancelled")
        .maybeSingle();
      if (existing) {
        return { created: false, alreadyExisted: true, existingId: existing.id };
      }

      const defaults = await loadDefaultDocsForApplication({
        unitId,
        candidateId: application.candidate_id,
        jobTitle,
      });
      if (defaults.length === 0) {
        throw new Error(
          "Nenhum checklist padrão configurado. Configure em Configurações → Documentos ou solicite manualmente pelo botão.",
        );
      }

      const documentsList = defaults.map((d) => ({ name: d.name, required: d.required }));
      const created: any = await createRequest.mutateAsync({
        applicationId: application.id,
        candidateId: application.candidate_id,
        unitId,
        jobId,
        documentsList,
      });

      const requestId = String(created?.id ?? "");

      // MESMA notificação canônica do DocumentRequestDialog: dedup por 5s +
      // skipIfAlreadyDelivered pelo request_id garantem no-op em corrida.
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
          _title: "Documentos solicitados",
          _body:
            "Você está na etapa de envio de documentos. Acesse o app para enviar os arquivos solicitados.",
        },
      });

      return { created: true, requestId };
    },
  });
}
