import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * integration-health-check
 * Enforces CrossConfig integrations.* keys:
 * - default_ai_provider: identifies which AI provider to use
 * - allow_multi_providers: if false, only default provider is allowed
 * - auto_fallback_enabled: if true, attempts fallback provider on failure
 * - health_check_interval_min: consumed by cron scheduler
 * - allow_storage_external: if true, external storage integrations are active
 *
 * This function checks the health of all active integrations and updates their status.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Read integration config from CrossConfig
    const { data: integrationConfig } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "integrations");

    const getVal = (key: string, fallback: any) => {
      const s = (integrationConfig || []).find((s: any) => s.key === key);
      if (!s) return fallback;
      const v = s.value;
      if (v === "true" || v === true) return true;
      if (v === "false" || v === false) return false;
      return v;
    };

    const defaultProvider = String(getVal("default_ai_provider", "openai"));
    const allowMultiProviders = getVal("allow_multi_providers", false);
    const autoFallbackEnabled = getVal("auto_fallback_enabled", false);
    const allowStorageExternal = getVal("allow_storage_external", false);

    // Get all active integrations
    const { data: integrations, error: intErr } = await supabase
      .from("integration_settings")
      .select("*")
      .eq("is_active", true);

    if (intErr) throw intErr;

    const results: { id: string; provider: string; type: string; status: string; latency_ms: number; error?: string }[] = [];

    for (const integration of (integrations || [])) {
      const startMs = Date.now();
      let status = "healthy";
      let error: string | undefined;

      try {
        // Provider-specific health checks
        if (integration.integration_type === "ai" && integration.provider === "openai") {
          const apiKey = Deno.env.get("OPENAI_API_KEY");
          if (!apiKey) {
            status = "degraded";
            error = "OPENAI_API_KEY not configured";
          } else {
            // Lightweight models endpoint check
            const res = await fetch("https://api.openai.com/v1/models", {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) {
              status = "unhealthy";
              error = `HTTP ${res.status}`;
            }
          }
        } else if (integration.integration_type === "email" || integration.integration_type === "whatsapp") {
          // Check if the provider endpoint is reachable
          const config = integration.config_json || {};
          const endpoint = config.api_url || config.endpoint;
          if (endpoint) {
            try {
              const res = await fetch(endpoint, {
                method: "HEAD",
                signal: AbortSignal.timeout(5000),
              });
              if (!res.ok && res.status !== 405) {
                status = "degraded";
                error = `HTTP ${res.status}`;
              }
            } catch (e: any) {
              status = "degraded";
              error = e.message;
            }
          } else {
            status = "unknown";
            error = "No endpoint configured";
          }
        } else if (integration.integration_type === "storage" && !allowStorageExternal) {
          status = "disabled";
          error = "allow_storage_external is false";
        }

        // If multi-providers is disabled, mark non-default AI providers as disabled
        if (integration.integration_type === "ai" && !allowMultiProviders && integration.provider !== defaultProvider) {
          status = "disabled";
          error = `Only ${defaultProvider} allowed (allow_multi_providers=false)`;
        }
      } catch (e: any) {
        status = "unhealthy";
        error = e.message;
      }

      const latencyMs = Date.now() - startMs;

      // Update integration status in DB
      await supabase
        .from("integration_settings")
        .update({
          status,
          last_health_check: new Date().toISOString(),
        })
        .eq("id", integration.id);

      // Log the health check
      await supabase.from("integration_logs").insert({
        integration_id: integration.id,
        event: "health_check",
        success: status === "healthy",
        context: {
          status,
          latency_ms: latencyMs,
          error: error || null,
          provider: integration.provider,
          type: integration.integration_type,
        },
      });

      results.push({
        id: integration.id,
        provider: integration.provider,
        type: integration.integration_type,
        status,
        latency_ms: latencyMs,
        ...(error ? { error } : {}),
      });
    }

    // Handle auto_fallback: if default provider is unhealthy and fallback is enabled
    if (autoFallbackEnabled) {
      const defaultResult = results.find(r => r.type === "ai" && r.provider === defaultProvider);
      if (defaultResult && defaultResult.status === "unhealthy") {
        const fallbackProvider = results.find(r => r.type === "ai" && r.provider !== defaultProvider && r.status === "healthy");
        if (fallbackProvider) {
          // Log fallback activation
          await supabase.from("activity_logs").insert({
            action: "ai_provider_fallback_activated",
            module: "integrations",
            details: {
              from: defaultProvider,
              to: fallbackProvider.provider,
              reason: defaultResult.error,
            },
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        default_provider: defaultProvider,
        allow_multi_providers: allowMultiProviders,
        auto_fallback_enabled: autoFallbackEnabled,
        allow_storage_external: allowStorageExternal,
        checked: results.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("integration-health-check error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
