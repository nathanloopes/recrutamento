import { corsHeaders, createAdminClient, createCallerClient, decodeJwtPayload, DevicePayload, getBearerToken, getIpFromRequest, hashWithPepper, buildDeviceHashes, deriveBrowserName, deriveOsName, logIdentityEvent } from "../_shared/identity.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: corsHeaders });

  try {
    const bearer = getBearerToken(req);
    const authHeader = `Bearer ${bearer}`;
    const caller = createCallerClient(authHeader);
    const admin = createAdminClient();

    const [{ data: authData, error: authError }, body] = await Promise.all([
      caller.auth.getUser(),
      req.json(),
    ]);

    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "invalid_session" }), { status: 401, headers: corsHeaders });
    }

    const device = body as DevicePayload;
    if (!device?.device_seed) {
      return new Response(JSON.stringify({ error: "missing_device_seed" }), { status: 400, headers: corsHeaders });
    }

    const jwt = decodeJwtPayload(bearer);
    const supabaseSessionId = String(jwt.session_id || "");
    if (!supabaseSessionId) {
      return new Response(JSON.stringify({ error: "missing_session_id_claim" }), { status: 400, headers: corsHeaders });
    }

    const ipHash = await hashWithPepper(getIpFromRequest(req));
    const hashes = await buildDeviceHashes({ ...device, user_agent: device.user_agent || req.headers.get("user-agent") || "unknown" });
    const browserName = await deriveBrowserName(device.user_agent || req.headers.get("user-agent") || undefined);
    const osName = await deriveOsName(device.user_agent || req.headers.get("user-agent") || undefined, device.platform);
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
    const absoluteExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: deviceRow, error: deviceError } = await admin
      .from("identity_devices")
      .upsert({
        user_id: authData.user.id,
        client_type: "web",
        device_seed_hash: hashes.deviceSeedHash,
        fingerprint_hash: hashes.fingerprintHash,
        fingerprint_version: device.fingerprint_version || 1,
        device_label: device.device_label || "Web Browser",
        platform: device.platform || "unknown",
        browser_name: browserName,
        os_name: osName,
        app_version: device.app_version || "web",
        user_agent_hash: hashes.userAgentHash,
        last_seen_at: now.toISOString(),
        metadata: {
          language: device.language || "unknown",
          timezone: device.timezone || "unknown",
          screen: device.screen || "unknown",
        },
      }, { onConflict: "user_id,client_type,device_seed_hash" })
      .select("id, trust_status, revoked_at")
      .single();

    if (deviceError || !deviceRow) {
      console.error("device_upsert_failed:", deviceError?.message);
      return new Response(JSON.stringify({ error: "device_upsert_failed" }), { status: 500, headers: corsHeaders });
    }

    if (deviceRow.revoked_at || deviceRow.trust_status === "revoked") {
      await logIdentityEvent(admin, {
        userId: authData.user.id,
        deviceId: deviceRow.id,
        eventType: "web_session_rejected_revoked_device",
        ipHash,
        userAgentHash: hashes.userAgentHash,
        riskScore: 80,
        details: { supabase_session_id: supabaseSessionId },
      });
      return new Response(JSON.stringify({ error: "device_revoked" }), { status: 403, headers: corsHeaders });
    }

    const { data: sessionRow, error: sessionError } = await admin
      .from("identity_sessions")
      .upsert({
        user_id: authData.user.id,
        device_id: deviceRow.id,
        client_type: "web",
        status: "active",
        auth_source: "supabase_password",
        assurance_level: 1,
        audience: "web",
        supabase_session_id: supabaseSessionId,
        last_seen_at: now.toISOString(),
        idle_expires_at: idleExpiresAt,
        absolute_expires_at: absoluteExpiresAt,
        last_ip_hash: ipHash,
        user_agent_hash: hashes.userAgentHash,
        metadata: {
          last_registration_source: "register-web-session",
        },
      }, { onConflict: "supabase_session_id" })
      .select("id, status, revoked_at")
      .single();

    if (sessionError || !sessionRow) {
      console.error("session_upsert_failed:", sessionError?.message);
      return new Response(JSON.stringify({ error: "session_upsert_failed" }), { status: 500, headers: corsHeaders });
    }

    if (sessionRow.revoked_at || sessionRow.status === "revoked") {
      return new Response(JSON.stringify({ error: "session_revoked", should_sign_out: true }), { status: 409, headers: corsHeaders });
    }

    await logIdentityEvent(admin, {
      userId: authData.user.id,
      sessionId: sessionRow.id,
      deviceId: deviceRow.id,
      eventType: "web_session_registered",
      ipHash,
      userAgentHash: hashes.userAgentHash,
      details: {
        supabase_session_id: supabaseSessionId,
        trust_status: deviceRow.trust_status,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      identity_session_id: sessionRow.id,
      identity_device_id: deviceRow.id,
      trust_status: deviceRow.trust_status,
      should_sign_out: false,
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("register-web-session error:", error);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: corsHeaders });
  }
});
