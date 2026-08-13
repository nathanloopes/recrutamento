import { createAdminClient } from "./cors.ts";

/**
 * Item 5: ai-log-guard — checks compliance.enable_ai_decision_log
 * Returns true if AI decision logging is enabled (default: true)
 */
export async function shouldLogAIDecision(
  admin?: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  const client = admin || createAdminClient();
  const { data } = await client
    .from("global_settings")
    .select("value")
    .eq("category", "compliance")
    .eq("key", "enable_ai_decision_log")
    .maybeSingle();

  if (!data) return true; // Default: enabled
  return data.value !== false && data.value !== "false";
}
