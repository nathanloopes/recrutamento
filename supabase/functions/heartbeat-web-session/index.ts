import { buildDeviceHashes, corsHeaders, createAdminClient, createCallerClient, decodeJwtPayload, DevicePayload, getBearerToken, getIpFromRequest, hashWithPepper, logIdentityEvent } from "../_shared/identity.ts";

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
      req.json().catch(() => ({})),
    ]);

    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "invalid_session", should_sign_out: true }), { status: 401, headers: corsHeaders });
    }

    const jwt = decodeJwtPayload(bearer);
    const supabaseSessionId = String(jwt.session_id || "");
    if (!supabaseSessionId) {
      return new Response(JSON.stringify({ error: "missing_session_id_claim", should_sign_out: true }), { status: 400, headers: corsHeaders });
    }

    const device = body as Partial<DevicePayload>;
    const requestUserAgent = device.user_agent || req.headers.get("user-agent") || "unknown";
    const hashes = device.device_seed
      ? await buildDeviceHashes({ ...device, device_seed: device.device_seed, user_agent: requestUserAgent } as DevicePayload)
      : { deviceSeedHash: null, fingerprintHash: null, userAgentHash: await hashWithPepper(requestUserAgent.toLowerCase()) };

    const ipHash = await hashWithPepper(getIpFromRequest(req));
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();

    const { data: sessionRow, error: sessionError } = await admin
      .from("identity_sessions")
      .select("id, device_id, status, revoked_at, absolute_expires_at")
      .eq("user_id", authData.user.id)
      .eq("supabase_session_id", supabaseSessionId)
      .maybeSingle();

    if (sessionError || !sessionRow) {
      return new Response(JSON.stringify({ error: "identity_session_not_found", should_sign_out: true }), { status: 404, headers: corsHeaders });
    }

    if (sessionRow.status !== "active" || sessionRow.revoked_at || new Date(sessionRow.absolute_expires_at).getTime() <= now.getTime()) {
      await logIdentityEvent(admin, {
        userId: authData.user.id,
        sessionId: sessionRow.id,
        deviceId: sessionRow.device_id,
        eventType: "web_session_heartbeat_rejected",
        ipHash,
        userAgentHash: hashes.userAgentHash,
        riskScore: 90,
      });
      return new Response(JSON.stringify({ error: "identity_session_inactive", should_sign_out: true }), { status: 409, headers: corsHeaders });
    }

    await admin.from("identity_sessions").update({
      last_seen_at: now.toISOString(),
      idle_expires_at: idleExpiresAt,
      last_ip_hash: ipHash,
      user_agent_hash: hashes.userAgentHash,
    }).eq("id", sessionRow.id);

    await admin.from("identity_devices").update({
      last_seen_at: now.toISOString(),
      user_agent_hash: hashes.userAgentHash,
      ...(hashes.fingerprintHash ? { fingerprint_hash: hashes.fingerprintHash } : {}),
    }).eq("id", sessionRow.device_id);

    await logIdentityEvent(admin, {
      userId: authData.user.id,
      sessionId: sessionRow.id,
      deviceId: sessionRow.device_id,
      eventType: "web_session_heartbeat",
      ipHash,
      userAgentHash: hashes.userAgentHash,
    });

    return new Response(JSON.stringify({ ok: true, should_sign_out: false }), { status: 200, headers: corsHeaders });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("heartbeat-web-session error:", error);
    return new Response(JSON.stringify({ error: "internal_error", should_sign_out: false }), { status: 500, headers: corsHeaders });
  }
});
