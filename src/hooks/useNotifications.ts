import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

// ── Templates ──

export function useNotificationTemplates(eventType?: string) {
  return useQuery({
    queryKey: ["notification_templates", eventType],
    queryFn: async () => {
      let q = supabase
        .from("notification_templates" as any)
        .select("*")
        .order("event_type")
        .order("channel");
      if (eventType) q = q.eq("event_type", eventType);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (vals: { event_type: string; channel: string; title?: string; body: string; variables?: string[]; priority?: string; status?: string }) => {
      const { error } = await supabase.from("notification_templates" as any).insert({ ...vals, status: vals.status || "draft" } as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["notification_templates"] });
      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "template_criado",
        module: "notificacoes",
        details: { event_type: vars.event_type, channel: vars.channel },
      } as any).then(() => {});
    },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...vals }: { id: string; [key: string]: any }) => {
      // Auto-increment version on every save
      const { data: current } = await supabase
        .from("notification_templates" as any)
        .select("version")
        .eq("id", id)
        .single();
      const currentVersion = (current as any)?.version || 1;
      const { error } = await supabase
        .from("notification_templates" as any)
        .update({ ...vals, version: currentVersion + 1 } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["notification_templates"] });
      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "template_atualizado",
        module: "notificacoes",
        details: { template_id: vars.id },
      } as any).then(() => {});
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notification_templates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["notification_templates"] });
      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "template_excluido",
        module: "notificacoes",
        details: { template_id: id },
      } as any).then(() => {});
    },
  });
}

// ── Helpers ──

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

async function fetchNotificationSettings(): Promise<Record<string, any>> {
  const { data } = await supabase
    .from("global_settings")
    .select("key, value")
    .eq("category", "notifications");
  const map: Record<string, any> = {};
  (data || []).forEach((s: any) => { map[s.key] = s.value; });
  return map;
}

// Verifica se o horário atual está dentro do período de silêncio configurado
function isInQuietHours(settings: Record<string, any>): boolean {
  const start = String(settings.quiet_hours_start || "");
  const end = String(settings.quiet_hours_end || "");
  if (!start || !end) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return false;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) {
    return currentMinutes >= startMin && currentMinutes < endMin;
  }
  // Crosses midnight
  return currentMinutes >= startMin || currentMinutes < endMin;
}

async function checkRateLimits(recipientId: string, settings: Record<string, any>): Promise<{ allowed: boolean; reason?: string }> {
  const maxPerHour = Number(settings.max_per_hour) || 30;
  const maxPerDay = Number(settings.max_per_day) || 100;
  const cooldownMinutes = Number(settings.cooldown_minutes) || 0;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // Check hourly limit
  const { count: hourCount } = await supabase
    .from("notifications" as any)
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", recipientId)
    .gte("created_at", oneHourAgo);
  if ((hourCount || 0) >= maxPerHour) return { allowed: false, reason: `Limite por hora excedido (${maxPerHour}/h)` };

  // Check daily limit
  const { count: dayCount } = await supabase
    .from("notifications" as any)
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", recipientId)
    .gte("created_at", startOfDay);
  if ((dayCount || 0) >= maxPerDay) return { allowed: false, reason: `Limite diário excedido (${maxPerDay}/dia)` };

  // Check cooldown — opt-in: only enforced when admin sets cooldown_minutes > 0
  if (cooldownMinutes > 0) {
    const cooldownAgo = new Date(now.getTime() - cooldownMinutes * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("notifications" as any)
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", recipientId)
      .gte("created_at", cooldownAgo);
    if ((recentCount || 0) > 0) {
      return { allowed: false, reason: `Cooldown ativo (${cooldownMinutes}min entre envios)` };
    }
  }

  return { allowed: true };
}

export async function sendPushToDevice(params: {
  recipientId: string;
  title: string;
  body: string;
  notificationId?: string;
  actionUrl?: string;
}): Promise<{ delivered: boolean; providerResponse: any }> {
  console.log("[PUSH] sendPushToDevice called:", { recipientId: params.recipientId, title: params.title, notificationId: params.notificationId, actionUrl: params.actionUrl });
  let delivered = false;
  let providerResponse: any = {};

  // Gap 10: If we have a notification_id, use cascade (reads cascade_order from CrossConfig)
  if (params.notificationId) {
    try {
      const { data, error } = await supabase.functions.invoke("send-notification-cascade", {
        body: { notification_id: params.notificationId },
      });
      if (error) {
        console.error("[PUSH] Cascade error:", error);
        providerResponse = { error: String(error), type: "cascade" };
      } else {
        delivered = data?.delivered === true;
        providerResponse = { ...data, type: "cascade" };
        console.log("[PUSH] Cascade result:", { delivered, data });
      }
    } catch (e: any) {
      console.error("[PUSH] Cascade exception:", e.message);
      providerResponse = { error: e.message, type: "cascade" };
    }
  } else {
    // Fallback: direct push when no notification_id (e.g. inline notifications)
    try {
      const { data, error } = await supabase.functions.invoke("send-push-notification", {
        body: {
          recipient_id: params.recipientId,
          title: params.title,
          body: params.body,
          notification_id: params.notificationId,
          data: { url: params.actionUrl || "/notificacoes" },
        },
      });
      if (error) {
        console.error("[PUSH] Edge function error:", error);
        providerResponse = { error: String(error), type: "native_push" };
      } else {
        delivered = data?.success !== false;
        providerResponse = { ...data, type: "native_push" };
        console.log("[PUSH] Edge function result:", { delivered, data });
      }
    } catch (e: any) {
      console.error("[PUSH] Exception calling edge function:", e.message);
      providerResponse = { error: e.message, type: "native_push" };
    }

    // Create delivery_log for direct push (cascade handles its own logging)
    try {
      await supabase.from("delivery_logs" as any).insert({
        notification_id: params.notificationId || null,
        channel: "push",
        delivered,
        provider_response: providerResponse,
      } as any);
    } catch (logErr) {
      console.error("[PUSH] Failed to insert delivery_log:", logErr);
    }

    // Update notification status for direct push
    if (params.notificationId) {
      try {
        await supabase.from("notifications" as any)
          .update({ status: delivered ? "sent" : "failed" } as any)
          .eq("id", params.notificationId);
      } catch (updErr) {
        console.error("[PUSH] Failed to update notification status:", updErr);
      }
    }
  }

  return { delivered, providerResponse };
}

async function dispatchToChannel(
  channel: string,
  recipientId: string,
  title: string,
  body: string,
  notificationId: string,
  actionUrl?: string
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
          subject: title,
          text_content: body,
          html_content: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <h2 style="color:#1a1a1a">${title}</h2>
            <p style="color:#333;line-height:1.6">${body}</p>
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
            <p style="color:#999;font-size:12px">Recruta — Sistema de Recrutamento</p>
          </div>`,
          notification_id: notificationId,
        },
      });
      if (error) return { delivered: false, providerResponse: { error: String(error) } };
      return { delivered: data?.success !== false, providerResponse: data };
    } catch (e: any) {
      return { delivered: false, providerResponse: { error: e.message } };
    }
  }

  // Push — call edge function to send real push notification
  // sendPushToDevice now handles delivery_logs + notification status internally
  return await sendPushToDevice({
    recipientId,
    title,
    body,
    notificationId,
    actionUrl,
  });
}

// ── Send Notification (with full engine) ──

export function useSendNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      eventType,
      recipientId,
      payload,
      channel = "push",
      dedupKey,
      dedupWindowSeconds,
      skipIfAlreadyDelivered,
    }: {
      eventType: string;
      recipientId: string;
      payload: Record<string, string>;
      channel?: string;
      /** Explicit dedup_key. If omitted, the DB trigger fn_auto_notification_dedup_key generates one (5min window). */
      dedupKey?: string;
      /** If set, builds dedup_key as `${eventType}:${recipientId}:${entity}:${floor(now/window)}`. */
      dedupWindowSeconds?: number;
      /** If true, skip insert when a notification with same event_type + matching payload key was already delivered/read. */
      skipIfAlreadyDelivered?: { matchPayloadKey: string; matchPayloadValue: string };
    }) => {
      // 0. Skip if an equivalent notification was already delivered/read
      // (prevents reissuing on edit/reopen of the same entity)
      if (skipIfAlreadyDelivered) {
        const { data: prior } = await supabase
          .from("notifications" as any)
          .select("id, status")
          .eq("recipient_id", recipientId)
          .eq("event_type", eventType)
          .filter(
            `payload->>${skipIfAlreadyDelivered.matchPayloadKey}`,
            "eq",
            skipIfAlreadyDelivered.matchPayloadValue,
          )
          .in("status", ["sent", "delivered", "read"])
          .limit(1);
        if (Array.isArray(prior) && prior.length > 0) {
          console.log(
            `[useSendNotification] Skipped (already delivered): ${eventType} → recipient ${recipientId}`,
          );
          return;
        }
      }

      // 0b. Compute explicit dedup_key (5s window for documents_requested, etc.)
      let computedDedupKey: string | null = dedupKey ?? null;
      if (!computedDedupKey && dedupWindowSeconds && dedupWindowSeconds > 0) {
        const entity =
          payload.request_id ||
          payload.application_id ||
          payload.interview_id ||
          payload.unit_job_id ||
          "";
        const bucket = Math.floor(Date.now() / (dedupWindowSeconds * 1000));
        computedDedupKey = `${eventType}:${recipientId}:${entity}:${bucket}`;
      }

      // 1. Load notification settings
      const settings = await fetchNotificationSettings();

      // 2. Kill switch check
      const enabled = settings.notifications_enabled;
      if (enabled === false || enabled === "false") {
        console.warn("Notifications disabled globally (kill switch)");
        await supabase.from("delivery_logs" as any).insert({
          notification_id: null,
          channel,
          delivered: false,
          provider_response: { blocked: true, reason: "kill_switch_global", event_type: eventType, recipient_id: recipientId },
        } as any);
        throw new Error("Notificações desativadas globalmente (kill switch). Ative em Configurações > Notificações.");
      }

      // 3. Quiet hours check
      if (isInQuietHours(settings)) {
        console.warn("Quiet hours active — notification blocked");
        // Create as queued so it's visible but not sent
        await supabase.from("notifications" as any).insert({
          event_type: eventType,
          recipient_id: recipientId,
          channel,
          payload,
          title: eventType,
          body: JSON.stringify(payload),
          status: "queued",
        } as any);
        await supabase.from("delivery_logs" as any).insert({
          notification_id: null,
          channel,
          delivered: false,
          provider_response: { blocked: true, reason: "quiet_hours", event_type: eventType, recipient_id: recipientId },
        } as any);
        throw new Error("Horário silencioso ativo. Notificação enfileirada para envio posterior.");
      }

      // 4. Rate limiting check
      const rateCheck = await checkRateLimits(recipientId, settings);
      if (!rateCheck.allowed) {
        console.warn("Rate limit hit:", rateCheck.reason);
        await supabase.from("delivery_logs" as any).insert({
          notification_id: null,
          channel,
          delivered: false,
          provider_response: { blocked: true, reason: rateCheck.reason, event_type: eventType, recipient_id: recipientId },
        } as any);
        throw new Error(`Bloqueado por rate limit: ${rateCheck.reason}`);
      }

      // 5. Routing is decided only by Configurações Globais.
      // The notification row keeps the global default as its canonical channel;
      // send-notification-cascade ignores caller/template channels for routing.
      const defaultChannel = String(settings.default_channel || "push").replace(/"/g, "").toLowerCase();

      // 6. Find active content template for the default channel, when it exists.
      const { data: templates } = await supabase
        .from("notification_templates" as any)
        .select("*")
        .eq("event_type", eventType)
        .eq("channel", defaultChannel)
        .eq("is_active", true)
        .limit(1);

      let tpl = (templates as any[])?.[0];

      const title = payload._title || (tpl ? renderTemplate(tpl.title || "", payload) : eventType);
      const body = payload._body || (tpl ? renderTemplate(tpl.body || "", payload) : `Notificação: ${eventType}`);

      // 7. Resolve deep link
      const { actionUrl, actionType } = resolveNotificationRoute(eventType, payload);

      // 8. Create notification record (debounce via dedup_key — duplicates within window are silently dropped)
      const insertPayload: any = {
        event_type: eventType,
        recipient_id: recipientId,
        channel: defaultChannel,
        template_id: tpl?.id || null,
        payload,
        title,
        body,
        status: "pending",
        action_url: actionUrl,
        action_type: actionType,
      };
      if (computedDedupKey) insertPayload.dedup_key = computedDedupKey;

      const { error } = await supabase
        .from("notifications" as any)
        .insert(insertPayload);
      if (error) {
        // Unique violation on dedup_key → debounce worked, treat as success silently
        if ((error as any).code === "23505") {
          console.log(
            `[useSendNotification] Debounced (dedup_key conflict): ${eventType} → recipient ${recipientId}`,
          );
          return;
        }
        throw error;
      }

      // 8. Delivery is handled exclusively by the DB trigger
      //    `notifications_dispatch_cascade` → Edge Function `send-notification-cascade`,
      //    which executes the full 9-step engine (kill switch, quiet hours, rate limits,
      //    cascade Push → WhatsApp → Email, fallback, delivery_logs).
      //    Calling dispatchToChannel / sendPushToDevice here too would duplicate the push
      //    (2x or 3x notifications on the user's device). Do NOT re-dispatch from the client.
      void channel;
      void title;
      void body;
      void actionUrl;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
      qc.invalidateQueries({ queryKey: ["unread_count"] });
    },
  });
}

// ── Candidate Notifications ──

export function useMyNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_notifications", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications" as any)
        .select("*")
        .eq("recipient_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 30000,
  });
}

export function useUnreadCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["unread_count", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications" as any)
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user!.id)
        .is("read_at", null)
        .in("status", ["sent", "pending", "failed", "unread"]);
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30000,
  });
}

// ── Realtime subscription for instant notification updates ──
export function useNotificationRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["my_notifications", user.id] });
          qc.invalidateQueries({ queryKey: ["unread_count", user.id] });
          qc.invalidateQueries({ queryKey: ["module_badges", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications" as any)
        .update({ read_at: new Date().toISOString(), status: "read" } as any)
        .eq("id", notificationId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
      qc.invalidateQueries({ queryKey: ["unread_count"] });
    },
  });
}

export function useMarkAllAsRead() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications" as any)
        .update({ read_at: new Date().toISOString(), status: "read" } as any)
        .eq("recipient_id", user!.id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
      qc.invalidateQueries({ queryKey: ["unread_count"] });
    },
  });
}

async function closeVisibleNotificationBanners(notificationIds: string[]) {
  if (!notificationIds.length) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const visible = await reg.getNotifications();
    const ids = new Set(notificationIds);
    visible.forEach((notification) => {
      const tag = notification.tag || (notification as any).data?.tag;
      if (tag && ids.has(tag)) notification.close();
    });
  } catch {
    // silencioso: ausência de permissão/SW não deve afetar leitura do chat
  }
}

/**
 * Marks all unread `conversation.new_message` notifications for a given thread
 * as read for the current user. Call when the user opens the chat thread.
 */
export function useMarkConversationNotificationsRead(threadId?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!threadId || !user?.id) return;
    let cancelled = false;

    const run = async () => {
      // Reset otimista do cache local para badge sumir instantaneamente
      const cachedList = qc.getQueryData<any[]>(["my_notifications", user.id]);
      let unreadFromThread = 0;
      let notificationIds: string[] = [];
      if (Array.isArray(cachedList)) {
        const unreadNotifications = cachedList.filter(
          (n) =>
            n?.event_type === "conversation.new_message" &&
            n?.payload?.thread_id === threadId &&
            !n?.read_at
        );
        unreadFromThread = unreadNotifications.length;
        notificationIds = unreadNotifications.map((n) => n?.id).filter(Boolean);
        const stamp = new Date().toISOString();
        qc.setQueryData<any[]>(["my_notifications", user.id], (prev) =>
          (prev || []).map((n) =>
            n?.event_type === "conversation.new_message" &&
            n?.payload?.thread_id === threadId &&
            !n?.read_at
              ? { ...n, read_at: stamp, status: "read" }
              : n
          )
        );
      }
      qc.setQueryData<number>(["conv-unread-total", user.id], (prev) =>
        Math.max(0, (typeof prev === "number" ? prev : 0) - unreadFromThread)
      );
      qc.setQueriesData({ queryKey: ["conv-threads"] }, (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((thread) =>
          thread?.id === threadId ? { ...thread, unreadCount: 0 } : thread
        );
      });
      qc.setQueryData<number>(["unread_count", user.id], (prev) =>
        Math.max(0, (typeof prev === "number" ? prev : 0) - unreadFromThread)
      );

      if (notificationIds.length === 0) {
        const { data } = await supabase
          .from("notifications" as any)
          .select("id")
          .eq("recipient_id", user.id)
          .eq("event_type", "conversation.new_message")
          .is("read_at", null)
          .filter("payload->>thread_id", "eq", threadId);
        notificationIds = ((data || []) as any[]).map((n) => n?.id).filter(Boolean);
      }

      const { error } = await supabase
        .from("notifications" as any)
        .update({ read_at: new Date().toISOString(), status: "read" } as any)
        .eq("recipient_id", user.id)
        .eq("event_type", "conversation.new_message")
        .is("read_at", null)
        .filter("payload->>thread_id", "eq", threadId);
      if (cancelled) return;
      if (!error) {
        closeVisibleNotificationBanners(notificationIds);
        qc.invalidateQueries({ queryKey: ["my_notifications", user.id] });
        qc.invalidateQueries({ queryKey: ["unread_count", user.id] });
        qc.invalidateQueries({ queryKey: ["module_badges", user.id] });
        qc.invalidateQueries({ queryKey: ["conv-unread-total"] });
        qc.invalidateQueries({ queryKey: ["conv-threads"] });
      }
    };

    run();
    const onFocus = () => run();
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [threadId, user?.id, qc]);
}


// ── Admin Delivery Logs ──

export function useAdminDeliveryLogs() {
  return useQuery({
    queryKey: ["delivery_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_logs" as any)
        .select("*, notifications!inner(event_type, recipient_id, channel, title, status, created_at)")
        .order("attempted_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as any[];
    },
  });
}
