import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Types ──

interface DeliveryLogFilters {
  channel?: string;
  delivered?: boolean | null;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface ChannelMetrics {
  channel: string;
  total: number;
  delivered: number;
  failed: number;
  rate: number;
}

interface AuditMetrics {
  total: number;
  delivered: number;
  failed: number;
  rate: number;
  byChannel: ChannelMetrics[];
  rawLogs: any[];
}

// ── Audit Metrics ──

export function useNotificationAuditMetrics() {
  return useQuery({
    queryKey: ["notification_audit_metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_logs" as any)
        .select("id, channel, delivered, notification_id, attempted_at, notifications!inner(event_type, channel, status)")
        .order("attempted_at", { ascending: false });

      if (error) throw error;
      const logs = (data as any[]) || [];

      const total = logs.length;
      const delivered = logs.filter(l => l.delivered).length;
      const failed = total - delivered;
      const rate = total > 0 ? Math.round((delivered / total) * 100) : 0;

      const channelMap: Record<string, { total: number; delivered: number }> = {};
      for (const l of logs) {
        const ch = l.channel || "push";
        if (!channelMap[ch]) channelMap[ch] = { total: 0, delivered: 0 };
        channelMap[ch].total++;
        if (l.delivered) channelMap[ch].delivered++;
      }

      const byChannel: ChannelMetrics[] = Object.entries(channelMap).map(([channel, m]) => ({
        channel,
        total: m.total,
        delivered: m.delivered,
        failed: m.total - m.delivered,
        rate: m.total > 0 ? Math.round((m.delivered / m.total) * 100) : 0,
      }));

      return { total, delivered, failed, rate, byChannel, rawLogs: logs } as AuditMetrics;
    },
  });
}

// ── Filtered Delivery Logs ──

export function useFilteredDeliveryLogs(filters: DeliveryLogFilters) {
  return useQuery({
    queryKey: ["filtered_delivery_logs", filters],
    queryFn: async () => {
      let q = supabase
        .from("delivery_logs" as any)
        .select("id, channel, delivered, provider_response, attempted_at, notification_id, notifications!inner(id, event_type, recipient_id, channel, payload, title, body, status, created_at)")
        .order("attempted_at", { ascending: false })
        .limit(200);

      if (filters.channel && filters.channel !== "all") {
        q = q.eq("channel", filters.channel);
      }
      if (filters.delivered !== null && filters.delivered !== undefined) {
        q = q.eq("delivered", filters.delivered);
      }
      if (filters.dateFrom) {
        q = q.gte("attempted_at", filters.dateFrom);
      }
      if (filters.dateTo) {
        q = q.lte("attempted_at", filters.dateTo + "T23:59:59");
      }

      const { data, error } = await q;
      if (error) throw error;
      let results = (data as any[]) || [];
      
      if (filters.eventType && filters.eventType !== "all") {
        results = results.filter(l => l.notifications?.event_type === filters.eventType);
      }
      
      return results;
    },
  });
}

// ── Helpers for fallback dispatch ──

async function dispatchToChannel(
  channel: string,
  recipientId: string,
  title: string,
  body: string,
  notificationId: string
): Promise<{ delivered: boolean; providerResponse: any }> {
  if (channel === "whatsapp") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone")
      .eq("id", recipientId)
      .single();
    if (!profile?.phone) return { delivered: false, providerResponse: { error: "no_phone" } };
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: { phone: profile.phone, message: `*${title}*\n\n${body}`, notification_id: notificationId },
      });
      if (error) return { delivered: false, providerResponse: { error: String(error) } };
      return { delivered: data?.success !== false, providerResponse: data };
    } catch (e: any) {
      return { delivered: false, providerResponse: { error: e.message } };
    }
  }

  if (channel === "email") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", recipientId)
      .single();
    if (!profile?.email) return { delivered: false, providerResponse: { error: "no_email" } };
    try {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to_email: profile.email,
          to_name: profile.full_name,
          subject: title || "Notificação",
          text_content: body || "",
          html_content: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>${title || ""}</h2><p>${body || ""}</p></div>`,
          notification_id: notificationId,
        },
      });
      if (error) return { delivered: false, providerResponse: { error: String(error) } };
      return { delivered: data?.success !== false, providerResponse: data };
    } catch (e: any) {
      return { delivered: false, providerResponse: { error: e.message } };
    }
  }

  // Push in-app
  await supabase.from("notifications" as any).update({ status: "sent" } as any).eq("id", notificationId);
  return { delivered: true, providerResponse: { type: "in_app", reprocessed: true } };
}

// ── Reprocess Failed Notification (with automatic fallback) ──

export function useReprocessNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      // Fetch original notification
      const { data: notif, error: nErr } = await supabase
        .from("notifications" as any)
        .select("*")
        .eq("id", notificationId)
        .single();
      if (nErr || !notif) throw new Error("Notificação não encontrada");

      const n = notif as any;
      const channel = n.channel || "push";

      // Try original channel
      const result = await dispatchToChannel(channel, n.recipient_id, n.title || "", n.body || "", notificationId);

      if (result.delivered) {
        await supabase
          .from("notifications" as any)
          .update({ status: "sent" } as any)
          .eq("id", notificationId);

        await supabase.from("delivery_logs" as any).insert({
          notification_id: notificationId,
          channel,
          delivered: true,
          provider_response: { ...result.providerResponse, reprocessed: true },
        } as any);

        return { delivered: true, channel };
      }

      // Primary failed — log it
      await supabase.from("delivery_logs" as any).insert({
        notification_id: notificationId,
        channel,
        delivered: false,
        provider_response: { ...result.providerResponse, reprocessed: true, fallback_triggered: true },
      } as any);

      // Try fallback
      const { data: settingsData } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "notifications")
        .in("key", ["fallback_enabled", "fallback_channel"]);

      const settingsMap: Record<string, any> = {};
      (settingsData || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

      const fallbackEnabled = settingsMap.fallback_enabled;
      if (fallbackEnabled === false || fallbackEnabled === "false") {
        await supabase.from("notifications" as any).update({ status: "failed" } as any).eq("id", notificationId);
        return { delivered: false, channel };
      }

      const fallbackChannel = String(settingsMap.fallback_channel || "push");
      if (fallbackChannel === channel) {
        await supabase.from("notifications" as any).update({ status: "failed" } as any).eq("id", notificationId);
        return { delivered: false, channel };
      }

      const fallbackResult = await dispatchToChannel(fallbackChannel, n.recipient_id, n.title || "", n.body || "", notificationId);

      await supabase
        .from("notifications" as any)
        .update({
          status: fallbackResult.delivered ? "sent" : "failed",
          channel: fallbackChannel,
        } as any)
        .eq("id", notificationId);

      await supabase.from("delivery_logs" as any).insert({
        notification_id: notificationId,
        channel: fallbackChannel,
        delivered: fallbackResult.delivered,
        provider_response: { ...fallbackResult.providerResponse, reprocessed: true, fallback_applied: true },
      } as any);

      return { delivered: fallbackResult.delivered, channel: fallbackChannel };
    },
    onSuccess: (result) => {
      if (result.delivered) {
        toast.success(`Notificação reenviada com sucesso via ${result.channel}!`);
      } else {
        toast.warning("Reprocessamento executado, mas entrega falhou em todos os canais.");
      }
      qc.invalidateQueries({ queryKey: ["filtered_delivery_logs"] });
      qc.invalidateQueries({ queryKey: ["notification_audit_metrics"] });
      qc.invalidateQueries({ queryKey: ["delivery_logs"] });
    },
    onError: (e: any) => {
      toast.error("Erro ao reprocessar: " + e.message);
    },
  });
}
