import { supabase } from "@/integrations/supabase/client";

/**
 * Check if a feature is enabled (non-reactive, for use outside React components)
 */
export async function checkFeatureEnabled(
  moduleName: string,
  environment?: string
): Promise<boolean> {
  // If no environment provided, read default from CrossConfig
  let env = environment;
  if (!env) {
    const { data: envSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "feature_control")
      .eq("key", "default_environment")
      .maybeSingle();
    env = (envSetting?.value as string) || "production";
  }
  // Check if feature control is enabled; if disabled, bypass all flags (return true)
  const { data: controlData } = await supabase
    .from("global_settings")
    .select("value")
    .eq("category", "feature_control")
    .eq("key", "feature_control_enabled")
    .maybeSingle();

  if (controlData && (controlData.value === false || controlData.value === "false")) {
    return true; // Feature control disabled = all modules active
  }

  const { data, error } = await supabase
    .from("feature_flags" as any)
    .select("enabled")
    .eq("module_name", moduleName)
    .eq("environment", env)
    .maybeSingle();

  if (error || !data) return false;
  return (data as any).enabled === true;

}

/**
 * Check if a feature is enabled for a specific unit (rollout_config check)
 */
export async function checkFeatureEnabledForUnit(
  moduleName: string,
  unitId: string,
  environment = "production"
): Promise<boolean> {
  const { data, error } = await supabase
    .from("feature_flags" as any)
    .select("enabled, rollout_strategy, rollout_config")
    .eq("module_name", moduleName)
    .eq("environment", environment)
    .maybeSingle();



  if (error || !data) return false;
  const flag = data as any;

  if (!flag.enabled) return false;
  if (flag.rollout_strategy === "total") return true;

  const config = flag.rollout_config || {};

  // Check unit_ids in rollout_config
  if (config.unit_ids && Array.isArray(config.unit_ids)) {
    return config.unit_ids.includes(unitId);
  }

  // Percentage-based rollout — deterministic hash of unitId
  if (flag.rollout_strategy === "gradual" && typeof config.percentage === "number") {
    const hash = unitId.split("").reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
    const bucket = Math.abs(hash) % 100;
    return bucket < config.percentage;
  }

  // P8: Cargo-based rollout — check if unit has any of the allowed job_ids
  if (flag.rollout_strategy === "cargo_based" && config.job_ids && Array.isArray(config.job_ids) && config.job_ids.length > 0) {
    const { data: unitJobs } = await supabase
      .from("unit_jobs" as any)
      .select("job_id")
      .eq("unit_id", unitId)
      .eq("status", "aberta");
    if (!unitJobs || unitJobs.length === 0) return false;
    const activeJobIds = unitJobs.map((j: any) => j.job_id);
    return config.job_ids.some((jid: string) => activeJobIds.includes(jid));
  }

  // P4: Role-based rollout — check if user has any of the allowed roles
  if (config.roles && Array.isArray(config.roles) && config.roles.length > 0) {
    const { data: userRoles } = await supabase
      .from("user_roles" as any)
      .select("role")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id || "");
    
    if (!userRoles || userRoles.length === 0) return false;
    const userRoleNames = userRoles.map((r: any) => r.role);
    return config.roles.some((r: string) => userRoleNames.includes(r));
  }

  return true;
}
