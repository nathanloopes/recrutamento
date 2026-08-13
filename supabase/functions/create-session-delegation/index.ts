import { corsHeaders, createAdminClient, createCallerClient, decodeJwtPayload, getBearerToken, getIpFromRequest, hashWithPepper, logIdentityEvent, randomBase64Url } from "../_shared/identity.ts";

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

    const targetClientType = String(body.target_client_type || "");
    const codeChallenge = String(body.code_challenge || "");
    const requestedScopes = Array.isArray(body.requested_scopes) ? body.requested_scopes.map(String) : [];
    if (!targetClientType || !["mobile", "api", "integration"].includes(targetClientType)) {
      return new Response(JSON.stringify({ error: "invalid_target_client_type" }), { status: 400, headers: corsHeaders });
    }
    if (!codeChallenge) {
      return new Response(JSON.stringify({ error: "missing_code_challenge" }), { status: 400, headers: corsHeaders });
    }

    const payload = decodeJwtPayload(bearer);
    const supabaseSessionId = String(payload.session_id || "");
    if (!supabaseSessionId) {
      return new Response(JSON.stringify({ error: "missing_session_id_claim" }), { status: 400, headers: corsHeaders });
    }

    const { data: sourceSession } = await admin
      .from("identity_sessions")
      .select("id, device_id, status, revoked_at")
      .eq("user_id", authData.user.id)
      .eq("supabase_session_id", supabaseSessionId)
      .maybeSingle();

    if (!sourceSession || sourceSession.status !== "active" || sourceSession.revoked_at) {
      return new Response(JSON.stringify({ error: "source_session_not_active" }), { status: 403, headers: corsHeaders });
    }

    const rawCode = randomBase64Url(32);
    const codeHash = await hashWithPepper(rawCode);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const ipHash = await hashWithPepper(getIpFromRequest(req));

    const { error: insertError } = await admin.from("identity_delegation_grants").insert({
      user_id: authData.user.id,
      source_session_id: sourceSession.id,
      source_device_id: sourceSession.device_id,
      target_client_type: targetClientType,
      code_hash: codeHash,
      code_challenge: codeChallenge,
      requested_scopes: requestedScopes,
      expires_at: expiresAt,
      metadata: {
        issued_from: "web",
        supabase_session_id: supabaseSessionId,
      },
    });

    if (insertError) {
      console.error("grant_insert_failed:", insertError.message);
      return new Response(JSON.stringify({ error: "grant_insert_failed" }), { status: 500, headers: corsHeaders });
    }

    await logIdentityEvent(admin, {
      userId: authData.user.id,
      sessionId: sourceSession.id,
      deviceId: sourceSession.device_id,
      eventType: "delegation_grant_created",
      ipHash,
      details: {
        target_client_type: targetClientType,
        requested_scopes: requestedScopes,
        expires_at: expiresAt,
      },
    });

    return new Response(JSON.stringify({ code: rawCode, expires_in_seconds: 60, target_client_type: targetClientType }), { status: 200, headers: corsHeaders });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("create-session-delegation error:", error);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: corsHeaders });
  }
});
