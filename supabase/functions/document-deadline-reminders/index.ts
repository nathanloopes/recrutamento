import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { notificationsEnabled } from "../_shared/config-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Kill switch global (Fase 2 — configGuard)
    if (!(await notificationsEnabled())) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "notifications_enabled is false" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if reminders are configured
    const { data: freqSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "documents")
      .eq("key", "reminder_frequency_days")
      .single();

    const frequencyDays = Number(freqSetting?.value ?? 3);
    if (frequencyDays <= 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "reminders disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find open document_requests with approaching deadlines
    const now = new Date();
    const { data: openRequests } = await supabase
      .from("document_requests")
      .select("id, candidate_id, deadline_date, application_id")
      .eq("status", "open")
      .not("deadline_date", "is", null);

    if (!openRequests || openRequests.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;

    for (const req of openRequests) {
      const deadline = new Date(req.deadline_date);
      if (deadline <= now) continue; // already expired

      // Check last reminder sent
      const { data: lastLog } = await supabase
        .from("document_logs")
        .select("created_at")
        .eq("request_id", req.id)
        .eq("event", "lembrete_enviado")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (lastLog) {
        const lastSent = new Date(lastLog.created_at);
        const daysSince = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < frequencyDays) continue;
      }

      // Send notification (single insert — cascade decides the channel)
      const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      await supabase.from("notifications").insert({
        event_type: "document_deadline_reminder",
        recipient_id: req.candidate_id,
        channel: "push",
        title: "Lembrete: documentos pendentes",
        body: `Você tem ${daysLeft} dia(s) para enviar seus documentos.`,
        status: "pending",
        payload: { request_id: req.id, days_left: daysLeft },
        action_url: "/documentos",
        action_type: "action_required",
      });

      // Log
      await supabase.from("document_logs").insert({
        candidate_id: req.candidate_id,
        request_id: req.id,
        event: "lembrete_enviado",
        metadata: { days_left: daysLeft, frequency_days: frequencyDays },
      });

      sent++;
    }

    // === Gap 3: Notify unit admins about pending document requests ===
    const unitPendingMap = new Map<string, { unitId: string; count: number }>();
    for (const r of openRequests) {
      const deadline = new Date(r.deadline_date);
      if (deadline <= now) continue;
      // We need unit_id — fetch from document_requests
      const { data: reqDetail } = await supabase
        .from("document_requests")
        .select("unit_id")
        .eq("id", r.id)
        .single();
      if (reqDetail?.unit_id) {
        const existing = unitPendingMap.get(reqDetail.unit_id) || { unitId: reqDetail.unit_id, count: 0 };
        existing.count++;
        unitPendingMap.set(reqDetail.unit_id, existing);
      }
    }

    let unitAlertsSent = 0;
    for (const [unitId, { count }] of unitPendingMap) {
      // Find admins/franchisees for this unit
      const { data: unitAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("unit_id", unitId)
        .in("role", ["franqueado", "gestor_recrutamento"]);

      for (const admin of (unitAdmins || [])) {
        await supabase.from("notifications").insert({
          event_type: "daily_document_pending_alert",
          recipient_id: admin.user_id,
          channel: "push",
          title: "Documentos pendentes na unidade",
          body: `Sua unidade possui ${count} checklist(s) de documentos aguardando ação.`,
          status: "pending",
          payload: { unit_id: unitId, pending_count: count },
          action_url: "/admin/documentos",
          action_type: "action_required",
        });
        unitAlertsSent++;
      }
    }

    return new Response(JSON.stringify({ sent, unitAlertsSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
