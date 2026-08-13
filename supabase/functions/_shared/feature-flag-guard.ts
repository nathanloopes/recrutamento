import { createAdminClient } from "./cors.ts";
import { corsHeaders } from "./cors.ts";

/**
 * Check if a feature flag module is enabled in production.
 * Returns null if enabled, or a 403 Response if disabled.
 */
export async function guardFeatureFlag(moduleName: string): Promise<Response | null> {
  try {
    const admin = createAdminClient();

    // Check if feature control is enabled
    const { data: controlData } = await admin
      .from("global_settings")
      .select("value")
      .eq("category", "feature_control")
      .eq("key", "feature_control_enabled")
      .maybeSingle();

    if (controlData && (controlData.value === false || controlData.value === "false")) {
      return null; // Feature control disabled = all modules active
    }

    // Check the specific flag
    const { data: flagData } = await admin
      .from("feature_flags")
      .select("enabled")
      .eq("module_name", moduleName)
      .eq("environment", "production")
      .maybeSingle();

    if (flagData && flagData.enabled === true) {
      return null; // Module is enabled
    }

    // Module disabled - log the blocked attempt
    await admin.from("activity_logs").insert({
      action: "module_blocked_by_flag",
      module: "feature_control",
      details: {
        module_name: moduleName,
        source: "edge_function",
        timestamp: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({ error: "module_disabled", message: `Módulo "${moduleName}" está desativado.` }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[FeatureFlagGuard] Error checking flag:", err);
    return null; // Fail-open to avoid blocking on transient errors
  }
}
