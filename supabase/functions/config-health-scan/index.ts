import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * config-health-scan
 *
 * Lê todas as chaves de global_settings e cruza com config_key_registry
 * para detectar:
 *   - órfãs    : registradas como 'active' mas sem valor em global_settings
 *   - não-registradas: existem em global_settings mas não no registry
 *   - duplicadas: mesma key em categorias diferentes
 *   - tipo errado: valor não bate com expected_type
 *
 * Grava snapshot em config_health_reports.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let triggered_by: "manual" | "cron" | "api" = "cron";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.triggered_by) triggered_by = body.triggered_by;
  } catch (_) { /* ignore */ }

  try {
    const [{ data: settings, error: e1 }, { data: registry, error: e2 }] = await Promise.all([
      admin.from("global_settings").select("category, key, value"),
      admin.from("config_key_registry").select("category, key, status, expected_type"),
    ]);

    if (e1 || e2) throw new Error(e1?.message || e2?.message || "load failed");

    const settingMap = new Map<string, unknown>();
    const dupCounter = new Map<string, number>();
    for (const s of settings ?? []) {
      const k = `${s.category}::${s.key}`;
      settingMap.set(k, s.value);
      dupCounter.set(s.key, (dupCounter.get(s.key) ?? 0) + 1);
    }

    const registryMap = new Map<string, { status: string; expected_type: string }>();
    for (const r of registry ?? []) {
      registryMap.set(`${r.category}::${r.key}`, { status: r.status, expected_type: r.expected_type });
    }

    const orphan_keys: Array<{ category: string; key: string }> = [];
    const unregistered_keys: Array<{ category: string; key: string }> = [];
    const type_mismatches: Array<{ category: string; key: string; expected: string; got: string }> = [];
    const duplicates: Array<{ key: string; count: number }> = [];
    let healthy = 0;
    let warning = 0;
    let critical = 0;

    // Active registry entries with no value -> orphan (warning)
    for (const [k, meta] of registryMap.entries()) {
      const [category, key] = k.split("::");
      if (meta.status === "active" && !settingMap.has(k)) {
        orphan_keys.push({ category, key });
        warning++;
      }
    }

    // Settings not in registry -> unregistered (critical)
    for (const [k, value] of settingMap.entries()) {
      const [category, key] = k.split("::");
      const reg = registryMap.get(k);
      if (!reg) {
        unregistered_keys.push({ category, key });
        critical++;
        continue;
      }
      // type check
      const got = Array.isArray(value) ? "array" : typeof value;
      const expected = reg.expected_type;
      if (expected !== "any" && got !== expected) {
        type_mismatches.push({ category, key, expected, got });
        warning++;
      } else {
        healthy++;
      }
    }

    // duplicate keys across categories
    for (const [key, count] of dupCounter.entries()) {
      if (count > 1) {
        duplicates.push({ key, count });
        warning++;
      }
    }

    const total_keys = (settings?.length ?? 0) + orphan_keys.length;

    const { data: inserted, error: insErr } = await admin
      .from("config_health_reports")
      .insert({
        total_keys,
        healthy_count: healthy,
        warning_count: warning,
        critical_count: critical,
        orphan_keys,
        unregistered_keys,
        duplicates,
        details: { type_mismatches },
        triggered_by,
      })
      .select("id")
      .single();

    if (insErr) throw insErr;

    return new Response(
      JSON.stringify({
        ok: true,
        report_id: inserted?.id,
        total_keys,
        healthy,
        warning,
        critical,
        orphans: orphan_keys.length,
        unregistered: unregistered_keys.length,
        duplicates: duplicates.length,
        type_mismatches: type_mismatches.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[config-health-scan] error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
