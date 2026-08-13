import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if auto-delete is enabled
    const { data: autoDeleteSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "documents")
      .eq("key", "retention_auto_delete")
      .single();

    if (autoDeleteSetting?.value !== true && autoDeleteSetting?.value !== "true") {
      return new Response(JSON.stringify({ skipped: true, reason: "retention_auto_delete disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get retention policy
    const { data: policySetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "documents")
      .eq("key", "retention_policy")
      .single();

    const policy = policySetting?.value as Record<string, number> | null;
    if (!policy) {
      return new Response(JSON.stringify({ skipped: true, reason: "no retention_policy configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map application statuses to retention months
    const statusMap: Record<string, string> = {
      reprovado: "reprovado",
      contratado: "contratado",
      desistente: "desistente",
    };

    const now = new Date();
    let cleaned = 0;

    for (const [statusKey, months] of Object.entries(policy)) {
      if (!months || Number(months) <= 0) continue;
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - Number(months));

      // Find completed document_requests for candidates with matching application status
      const appStatus = statusMap[statusKey];
      if (!appStatus) continue;

      const { data: requests } = await supabase
        .from("document_requests")
        .select("id, candidate_id, application_id")
        .eq("status", "completed")
        .lt("completed_at", cutoff.toISOString());

      if (!requests || requests.length === 0) continue;

      for (const dr of requests) {
        // Verify application status matches
        const { data: app } = await supabase
          .from("applications")
          .select("status")
          .eq("id", dr.application_id)
          .single();

        if (!app || app.status !== appStatus) continue;

        // Get uploads for this request
        const { data: uploads } = await supabase
          .from("document_uploads")
          .select("id, file_url")
          .eq("request_id", dr.id);

        if (!uploads) continue;

        for (const upload of uploads) {
          // Remove file from storage
          if (upload.file_url) {
            const path = upload.file_url.replace(/.*\/storage\/v1\/object\/[^/]+\//, "");
            await supabase.storage.from("documents").remove([path]);
          }

          // Anonymize record
          await supabase
            .from("document_uploads")
            .update({ file_url: "REDACTED", status: "expired" })
            .eq("id", upload.id);
        }

        // Log
        await supabase.from("document_logs").insert({
          candidate_id: dr.candidate_id,
          request_id: dr.id,
          event: "retencao_expirada",
          metadata: { policy_key: statusKey, months, cleaned_uploads: uploads.length },
        });

        cleaned += uploads.length;
      }
    }

    // Notify admins about retention cleanup
    if (cleaned > 0) {
      const { data: admins } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "rh_franqueadora"]);

      for (const admin of (admins || [])) {
        await supabase.from("notifications").insert({
          event_type: "retention_cleanup_completed",
          recipient_id: admin.user_id,
          channel: "push",
          title: "Limpeza de retenção concluída",
          body: `${cleaned} documento(s) foram anonimizados conforme a política de retenção.`,
          status: "pending",
          payload: { cleaned },
          action_url: "/admin/documentacao",
          action_type: "info",
        });
      }
    }

    return new Response(JSON.stringify({ cleaned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
