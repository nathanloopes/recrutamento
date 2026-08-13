import { supabase } from "@/integrations/supabase/client";

/**
 * Moves a candidate to standby status and ensures they're in the talent pool.
 * Per prompt fundador: "Candidato NUNCA é reprovado — entra em lista de oportunidade".
 */
export async function moveToStandby(
  candidateId: string,
  reason: string,
  jobId?: string,
) {
  // 1. Upsert talent_pool_entries with on_hold status
  const { data: existing } = await supabase
    .from("talent_pool_entries")
    .select("id")
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("talent_pool_entries")
      .update({
        status: "on_hold",
        standby_reason: reason,
        last_interaction: new Date().toISOString(),
        ...(jobId ? { last_job_id: jobId } : {}),
      } as any)
      .eq("id", existing.id);
  } else {
    await supabase
      .from("talent_pool_entries")
      .insert({
        candidate_id: candidateId,
        status: "on_hold",
        standby_reason: reason,
        last_interaction: new Date().toISOString(),
        ...(jobId ? { last_job_id: jobId } : {}),
      } as any);
  }
}
