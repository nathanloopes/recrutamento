import { corsHeaders, createAdminClient, getIpFromRequest, hashWithPepper, issueDelegatedAccessToken, logIdentityEvent, randomBase64Url, revokeSessionFamily } from "../_shared/identity.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: corsHeaders });

  try {
    const admin = createAdminClient();
    const body = await req.json();
    const rawRefreshToken = String(body.refresh_token || "");
    if (!rawRefreshToken) {
      return new Response(JSON.stringify({ error: "missing_refresh_token" }), { status: 400, headers: corsHeaders });
    }

    const tokenHash = await hashWithPepper(rawRefreshToken);
    const requestUserAgent = req.headers.get("user-agent") || "unknown";
    const userAgentHash = await hashWithPepper(requestUserAgent.toLowerCase());
    const ipHash = await hashWithPepper(getIpFromRequest(req));

    const { data: tokenRow, error: tokenError } = await admin
      .from("identity_refresh_tokens")
      .select("id, session_id, refresh_family_id, consumed_at, revoked_at, expires_at, replaced_by, session:identity_sessions(id, user_id, device_id, status, revoked_at, audience, client_type, absolute_expires_at)")
      .eq("token_hash", tokenHash)
      .maybeSingle() as { data: any; error: any };

    if (tokenError || !tokenRow || !tokenRow.session) {
      return new Response(JSON.stringify({ error: "invalid_refresh_token" }), { status: 401, headers: corsHeaders });
    }

    if (tokenRow.revoked_at || tokenRow.session.revoked_at || tokenRow.session.status !== "active") {
      return new Response(JSON.stringify({ error: "refresh_token_revoked" }), { status: 401, headers: corsHeaders });
    }

    if (new Date(tokenRow.expires_at).getTime() <= Date.now() || new Date(tokenRow.session.absolute_expires_at).getTime() <= Date.now()) {
      await revokeSessionFamily(admin, tokenRow.session_id, tokenRow.refresh_family_id, "refresh_expired");
      return new Response(JSON.stringify({ error: "refresh_token_expired" }), { status: 401, headers: corsHeaders });
    }

    if (tokenRow.consumed_at || tokenRow.replaced_by) {
      await revokeSessionFamily(admin, tokenRow.session_id, tokenRow.refresh_family_id, "refresh_replay_detected");
      await logIdentityEvent(admin, {
        userId: tokenRow.session.user_id,
        sessionId: tokenRow.session_id,
        deviceId: tokenRow.session.device_id,
        eventType: "refresh_replay_detected",
        ipHash,
        userAgentHash,
        riskScore: 95,
      });
      return new Response(JSON.stringify({ error: "refresh_replay_detected" }), { status: 401, headers: corsHeaders });
    }

    const now = new Date();
    const nextRefreshToken = randomBase64Url(48);
    const nextRefreshHash = await hashWithPepper(nextRefreshToken);
    const nextRefreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const nextIdleExpiresAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nextToken, error: nextTokenError } = await admin.from("identity_refresh_tokens").insert({
      session_id: tokenRow.session_id,
      refresh_family_id: tokenRow.refresh_family_id,
      token_hash: nextRefreshHash,
      expires_at: nextRefreshExpiresAt,
      ip_hash: ipHash,
      user_agent_hash: userAgentHash,
    }).select("id").single();

    if (nextTokenError || !nextToken) {
      console.error("refresh_rotation_failed:", nextTokenError?.message);
      return new Response(JSON.stringify({ error: "refresh_rotation_failed" }), { status: 500, headers: corsHeaders });
    }

    await admin.from("identity_refresh_tokens").update({
      consumed_at: now.toISOString(),
      replaced_by: nextToken.id,
    }).eq("id", tokenRow.id);

    await admin.from("identity_sessions").update({
      last_seen_at: now.toISOString(),
      idle_expires_at: nextIdleExpiresAt,
      last_ip_hash: ipHash,
      user_agent_hash: userAgentHash,
    }).eq("id", tokenRow.session_id);

    const accessToken = await issueDelegatedAccessToken({
      userId: tokenRow.session.user_id,
      sessionId: tokenRow.session_id,
      deviceId: tokenRow.session.device_id,
      audience: tokenRow.session.audience,
      scopes: [],
      clientType: tokenRow.session.client_type,
    });

    await logIdentityEvent(admin, {
      userId: tokenRow.session.user_id,
      sessionId: tokenRow.session_id,
      deviceId: tokenRow.session.device_id,
      eventType: "delegated_refresh_rotated",
      ipHash,
      userAgentHash,
      details: {
        refresh_family_id: tokenRow.refresh_family_id,
      },
    });

    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      token_type: "Bearer",
      expires_in: 300,
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("refresh-delegated-session error:", error);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: corsHeaders });
  }
});
