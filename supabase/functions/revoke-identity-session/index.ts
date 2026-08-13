import { corsHeaders, createAdminClient, createCallerClient, decodeJwtPayload, getBearerToken, getIpFromRequest, hashWithPepper, logIdentityEvent } from "../_shared/identity.ts";

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
      return new Response(JSON.stringify({ error: "invalid_session" }), { status: 401, headers: corsHeaders });
    }

    const payload = decodeJwtPayload(bearer);
    const currentSupabaseSessionId = String(payload.session_id || "");
    const targetSessionId = String(body.session_id || "");
    const reason = String(body.reason || "user_logout");
    const scope = String(body.scope || "current");
    const ipHash = await hashWithPepper(getIpFromRequest(req));

    let sessions: Array<{ id: string; device_id: string | null }> = [];

    if (scope === "all") {
      const { data } = await admin.from("identity_sessions")
        .select("id, device_id")
        .eq("user_id", authData.user.id)
        .eq("status", "active");
      sessions = data || [];
    } else if (targetSessionId) {
      const { data } = await admin.from("identity_sessions")
        .select("id, device_id")
        .eq("user_id", authData.user.id)
        .eq("id", targetSessionId)
        .maybeSingle();
      sessions = data ? [data] : [];
    } else {
      const { data } = await admin.from("identity_sessions")
        .select("id, device_id")
        .eq("user_id", authData.user.id)
        .eq("supabase_session_id", currentSupabaseSessionId)
        .maybeSingle();
      sessions = data ? [data] : [];
    }

    if (sessions.length === 0) {
      return new Response(JSON.stringify({ ok: true, revoked_count: 0 }), { status: 200, headers: corsHeaders });
    }

    for (const session of sessions) {
      await admin.rpc("identity_revoke_session", { _session_id: session.id, _reason: reason });
      await logIdentityEvent(admin, {
        userId: authData.user.id,
        sessionId: session.id,
        deviceId: session.device_id,
        eventType: "identity_session_revoked",
        ipHash,
        details: { reason, scope },
      });
    }

    return new Response(JSON.stringify({ ok: true, revoked_count: sessions.length }), { status: 200, headers: corsHeaders });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("revoke-identity-session error:", error);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: corsHeaders });
  }
});
