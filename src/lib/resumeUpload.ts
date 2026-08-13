import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";

export const MAX_RESUME_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function validateResumeFile(file: File): string | null {
  if (
    !ALLOWED_RESUME_TYPES.includes(file.type) &&
    !/\.(pdf|doc|docx)$/i.test(file.name)
  ) {
    return "Formato não aceito. Envie PDF, DOC ou DOCX.";
  }
  if (file.size > MAX_RESUME_SIZE) {
    return "Arquivo muito grande. Máximo: 10MB.";
  }
  return null;
}

/**
 * Faz upload do currículo no bucket `documents`, registra versão em
 * `resume_versions` e atualiza `candidate_profiles.resume_url`.
 * Mantém o mesmo comportamento usado em Register.tsx e Profile.tsx.
 */
export async function uploadResume(
  userId: string,
  file: File,
): Promise<{ path: string; version: number }> {
  const validationError = validateResumeFile(file);
  if (validationError) throw new Error(validationError);

  const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
  // Bucket `documents` RLS exige que a primeira pasta seja o auth.uid()
  const path = `${userId}/resumes/${Date.now()}.${ext}`;

  const storage = await getStorageClient();
  const { error: upErr } = await storage.storage
    .from("documents")
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
  if (upErr) throw upErr;

  // Calcula próxima versão
  const { data: lastVersion } = await supabase
    .from("resume_versions")
    .select("version")
    .eq("candidate_id", userId)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((lastVersion as any)?.version || 0) + 1;

  const { error: verErr } = await supabase.from("resume_versions").insert({
    candidate_id: userId,
    file_name: file.name,
    file_url: path,
    version: nextVersion,
  });
  if (verErr) {
    try {
      await storage.storage.from("documents").remove([path]);
    } catch {
      // best-effort cleanup
    }
    throw verErr;
  }

  // O registro em candidate_profiles pode ainda não existir em cenários de corrida
  // no pós-cadastro; upsert garante persistência do resume_url.
  const { error: profErr } = await supabase
    .from("candidate_profiles")
    .upsert({ candidate_id: userId, resume_url: path } as any, { onConflict: "candidate_id" });
  if (profErr) {
    try {
      await storage.storage.from("documents").remove([path]);
    } catch {
      // best-effort cleanup
    }
    throw profErr;
  }

  return { path, version: nextVersion };
}
