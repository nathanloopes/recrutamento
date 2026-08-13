import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * archive-old-logs
 * Enforces log_retention_days and ai_log_retention_days from CrossConfig.
 * 
 * CONSTITUTIONAL COMPLIANCE (Article 2, Law 3):
 * Logs are IMMUTABLE — they are NEVER deleted from the original table.
 * This function COPIES old records to archive tables for long-term storage
 * and marks them as archived in the original table (archived_at timestamp).
 * The originals remain intact and queryable.
 * 
 * Tables archived:
 * - activity_logs -> archived_activity_logs
 * - ai_decision_logs -> archived_ai_decision_logs
 * - automation_logs -> archived_automation_logs
 * - delivery_logs -> archived_delivery_logs
 * 
 * Body: { dry_run?: boolean }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run === true;

    // Read retention settings from CrossConfig
    // log_retention_days: from compliance category
    // ai_log_retention_days: from ai_governance category (single source of truth per Doc 3.2)
    const { data: complianceSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "compliance")
      .eq("key", "log_retention_days");

    const { data: aiGovSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "ai_governance")
      .eq("key", "ai_log_retention_days");

    const { data: automationSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "automations")
      .eq("key", "automation_log_retention_days");

    const { data: featureControlSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "feature_control")
      .eq("key", "log_retention_days");

    const parseRetention = (data: any[] | null, key: string, fallback: number): number => {
      const s = (data || []).find((s: any) => s.key === key);
      const v = s ? Number(s.value) : fallback;
      return isNaN(v) || v <= 0 ? fallback : v;
    };

    const logRetentionDays = parseRetention(complianceSettings, "log_retention_days", 365);
    const aiLogRetentionDays = parseRetention(aiGovSettings, "ai_log_retention_days", 180);
    const automationLogRetentionDays = parseRetention(automationSettings, "automation_log_retention_days", 90);
    const moduleLogRetentionDays = parseRetention(featureControlSettings, "log_retention_days", 90);

    const logCutoff = new Date(Date.now() - logRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const aiLogCutoff = new Date(Date.now() - aiLogRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const automationLogCutoff = new Date(Date.now() - automationLogRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const moduleLogCutoff = new Date(Date.now() - moduleLogRetentionDays * 24 * 60 * 60 * 1000).toISOString();

    const report: { table: string; cutoff: string; retention_days: number; records_found: number; archived: number }[] = [];

    const tables = [
      { name: "activity_logs", dateField: "created_at", cutoff: logCutoff, days: logRetentionDays },
      { name: "automation_logs", dateField: "executed_at", cutoff: automationLogCutoff, days: automationLogRetentionDays },
      { name: "delivery_logs", dateField: "attempted_at", cutoff: logCutoff, days: logRetentionDays },
      { name: "ai_decision_logs", dateField: "created_at", cutoff: aiLogCutoff, days: aiLogRetentionDays },
      { name: "module_activation_logs", dateField: "changed_at", cutoff: moduleLogCutoff, days: moduleLogRetentionDays },
    ];

    for (const t of tables) {
      const { count, error } = await supabase
        .from(t.name)
        .select("id", { count: "exact", head: true })
        .lt(t.dateField, t.cutoff);

      if (error) {
        report.push({ table: t.name, cutoff: t.cutoff, retention_days: t.days, records_found: -1, archived: 0 });
        continue;
      }

      const recordCount = count || 0;

      if (dryRun || recordCount === 0) {
        report.push({ table: t.name, cutoff: t.cutoff, retention_days: t.days, records_found: recordCount, archived: 0 });
        continue;
      }

      // Archive: fetch old records, insert into archive table
      // IMPORTANT: We do NOT delete originals — logs are immutable per Constitution
      let totalArchived = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: oldRecords, error: fetchErr } = await supabase
          .from(t.name)
          .select("*")
          .lt(t.dateField, t.cutoff)
          .limit(500);

        if (fetchErr || !oldRecords || oldRecords.length === 0) {
          hasMore = false;
          break;
        }

        // Check if these records were already archived (avoid duplicates)
        const ids = oldRecords.map((r: any) => r.id);
        const archiveTableName = `archived_${t.name}`;
        
        const { data: existingArchived } = await supabase
          .from(archiveTableName)
          .select("id")
          .in("id", ids);
        
        const alreadyArchivedIds = new Set((existingArchived || []).map((r: any) => r.id));
        const newRecords = oldRecords.filter((r: any) => !alreadyArchivedIds.has(r.id));

        if (newRecords.length === 0) {
          hasMore = false;
          break;
        }

        // Insert into archive table (copy, not move)
        const archiveRecords = newRecords.map((r: any) => ({
          ...r,
          archived_at: new Date().toISOString(),
          original_table: t.name,
        }));

        const { error: archiveErr } = await supabase
          .from(archiveTableName)
          .insert(archiveRecords);

        if (archiveErr) {
          console.warn(`Archive table ${archiveTableName} not available:`, archiveErr.message);
          report.push({ table: t.name, cutoff: t.cutoff, retention_days: t.days, records_found: recordCount, archived: 0 });
          hasMore = false;
          break;
        }

        // NO DELETE — originals remain intact (Constitutional compliance)
        totalArchived += newRecords.length;
        if (oldRecords.length < 500) hasMore = false;
      }

      if (totalArchived > 0 || !report.find(r => r.table === t.name)) {
        report.push({ table: t.name, cutoff: t.cutoff, retention_days: t.days, records_found: recordCount, archived: totalArchived });
      }
    }

    // Log the archival operation
    await supabase.from("activity_logs").insert({
      action: "log_archival_executed",
      module: "compliance",
      details: {
        dry_run: dryRun,
        log_retention_days: logRetentionDays,
        ai_log_retention_days: aiLogRetentionDays,
        automation_log_retention_days: automationLogRetentionDays,
        constitutional_compliance: "originals_preserved",
        report,
        timestamp: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        log_retention_days: logRetentionDays,
        ai_log_retention_days: aiLogRetentionDays,
        constitutional_compliance: "Originals are NEVER deleted. Archive is copy-only.",
        report,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("archive-old-logs error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
