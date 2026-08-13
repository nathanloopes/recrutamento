import { buildDeviceHashes, corsHeaders, createAdminClient, deriveBrowserName, deriveOsName, DevicePayload, getIpFromRequest, hashWithPepper, issueDelegatedAccessToken, logIdentityEvent, randomBase64Url, verifyPkce } from "../_shared/identity.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: corsHeaders });

  try {
    const admin = createAdminClient();
    const body = await req.json();

    const code = String(body.code || "");
    const codeVerifier = String(body.code_verifier || "");
    const audience = String(body.audience || body.target_client_type || "delegated-client");
    const device = body as DevicePayload;

    if (!code || !codeVerifier || !device?.device_seed) {
      return new Response(JSON.stringify({ error: "missing_exchange_payload" }), { status: 400, headers: corsHeaders });
    }

    const codeHash = await hashWithPepper(code);
    const { data: grant, error: grantError } = await admin
      .from("identity_delegation_grants")
      .select("id, user_id, source_session_id, source_device_id, target_client_type, code_challenge, requested_scopes, expires_at, consumed_at, cancelled_at")
      .eq("code_hash", codeHash)
      .maybeSingle();

    if (grantError || !grant) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401, headers: corsHeaders });
    }
    if (grant.cancelled_at || grant.consumed_at || new Date(grant.expires_at).getTime() <= Date.now()) {
      return new Response(JSON.stringify({ error: "grant_expired_or_consumed" }), { status: 401, headers: corsHeaders });
    }

    const pkceValid = await verifyPkce(codeVerifier, grant.code_challenge);
    if (!pkceValid) {
      await logIdentityEvent(admin, {
        userId: grant.user_id,
        sessionId: grant.source_session_id,
        deviceId: grant.source_device_id,
        eventType: "delegation_grant_pkce_failed",
        riskScore: 85,
      });
      return new Response(JSON.stringify({ error: "invalid_code_verifier" }), { status: 401, headers: corsHeaders });
    }

    const requestUserAgent = device.user_agent || req.headers.get("user-agent") || "unknown";
    const hashes = await buildDeviceHashes({ ...device, user_agent: requestUserAgent });
    const ipHash = await hashWithPepper(getIpFromRequest(req));
    const browserName = await deriveBrowserName(requestUserAgent);
    const osName = await deriveOsName(requestUserAgent, device.platform);
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
    const absoluteExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: deviceRow, error: deviceError } = await admin
      .from("identity_devices")
      .upsert({
        user_id: grant.user_id,
        client_type: grant.target_client_type,
        device_seed_hash: hashes.deviceSeedHash,
        fingerprint_hash: hashes.fingerprintHash,
        fingerprint_version: device.fingerprint_version || 1,
        device_label: device.device_label || `${grant.target_client_type} client`,
        platform: device.platform || "unknown",
        browser_name: browserName,
        os_name: osName,
        app_version: device.app_version || grant.target_client_type,
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
      return new Response(JSON.stringify({ error: "device_revoked" }), { status: 403, headers: corsHeaders });
    }

    const { data: sessionRow, error: sessionError } = await admin
      .from("identity_sessions")
      .insert({
        user_id: grant.user_id,
        device_id: deviceRow.id,
        client_type: grant.target_client_type,
        status: "active",
        auth_source: "delegated_session",
        assurance_level: 1,
        audience,
        delegated_from_session_id: grant.source_session_id,
        idle_expires_at: idleExpiresAt,
        absolute_expires_at: absoluteExpiresAt,
        last_ip_hash: ipHash,
        user_agent_hash: hashes.userAgentHash,
      })
      .select("id")
      .single();

    if (sessionError || !sessionRow) {
      console.error("delegated_session_insert_failed:", sessionError?.message);
      return new Response(JSON.stringify({ error: "delegated_session_insert_failed" }), { status: 500, headers: corsHeaders });
    }

    const refreshFamilyId = crypto.randomUUID();
    const rawRefreshToken = randomBase64Url(48);
    const refreshHash = await hashWithPepper(rawRefreshToken);
    const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: refreshError } = await admin.from("identity_refresh_tokens").insert({
      session_id: sessionRow.id,
      refresh_family_id: refreshFamilyId,
      token_hash: refreshHash,
      expires_at: refreshExpiresAt,
      ip_hash: ipHash,
      user_agent_hash: hashes.userAgentHash,
      metadata: { bootstrapped_from_grant: grant.id },
    });

    if (refreshError) {
      console.error("refresh_token_insert_failed:", refreshError.message);
      return new Response(JSON.stringify({ error: "refresh_token_insert_failed" }), { status: 500, headers: corsHeaders });
    }

    await admin.from("identity_delegation_grants").update({
      consumed_at: now.toISOString(),
      consumed_by_device_id: deviceRow.id,
    }).eq("id", grant.id);

    const accessToken = await issueDelegatedAccessToken({
      userId: grant.user_id,
      sessionId: sessionRow.id,
      deviceId: deviceRow.id,
      audience,
      scopes: grant.requested_scopes || [],
      clientType: grant.target_client_type,
    });

    await logIdentityEvent(admin, {
      userId: grant.user_id,
      sessionId: sessionRow.id,
      deviceId: deviceRow.id,
      eventType: "delegation_grant_consumed",
      ipHash,
      userAgentHash: hashes.userAgentHash,
      details: {
        grant_id: grant.id,
        audience,
        target_client_type: grant.target_client_type,
      },
    });

    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: rawRefreshToken,
      token_type: "Bearer",
      expires_in: 300,
      identity_session_id: sessionRow.id,
      identity_device_id: deviceRow.id,
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("exchange-session-delegation error:", error);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: corsHeaders });
  }
});
