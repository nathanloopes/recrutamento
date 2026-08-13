import { User } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, createAdminClient, createCallerClient, decodeJwtPayload, getBearerToken } from "./cors.ts";

export interface AuthenticatedRequestContext {
  user: User;
  userId: string;
  bearer: string;
  authHeader: string;
  jwtPayload: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
  caller: ReturnType<typeof createCallerClient>;
}

interface WithAuthOptions {
  allowedRoles?: string[];
  requireActiveIdentitySession?: boolean;
}

async function resolveAuthenticatedRequest(req: Request, requireActiveIdentitySession: boolean): Promise<AuthenticatedRequestContext | Response> {
  let bearer = "";

  try {
    bearer = getBearerToken(req);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const authHeader = `Bearer ${bearer}`;
  const caller = createCallerClient(authHeader);
  const admin = createAdminClient();
  const { data: authData, error: authError } = await caller.auth.getUser();

  if (authError || !authData.user) {
    return new Response(JSON.stringify({ error: "invalid_session" }), { status: 401, headers: corsHeaders });
  }

  const jwtPayload = decodeJwtPayload(bearer);

  if (requireActiveIdentitySession) {
    const supabaseSessionId = String(jwtPayload.session_id || "");
    if (supabaseSessionId) {
      const { data: identitySession, error: identitySessionError } = await admin
        .from("identity_sessions")
        .select("id, status, revoked_at")
        .eq("user_id", authData.user.id)
        .eq("supabase_session_id", supabaseSessionId)
        .maybeSingle();

      if (!identitySessionError && identitySession) {
        if (identitySession.revoked_at || identitySession.status === "revoked") {
          return new Response(JSON.stringify({ error: "session_revoked" }), { status: 401, headers: corsHeaders });
        }
      }
    }
  }

  return {
    user: authData.user,
    userId: authData.user.id,
    bearer,
    authHeader,
    jwtPayload,
    admin,
    caller,
  };
}

async function hasAnyRole(admin: ReturnType<typeof createAdminClient>, userId: string, roles: string[]) {
  for (const role of roles) {
    const { data } = await admin.rpc("has_role", { _user_id: userId, _role: role });
    if (data) return true;
  }

  return false;
}

export function withAuth(
  handler: (req: Request, ctx: AuthenticatedRequestContext) => Promise<Response>,
  options: WithAuthOptions = {},
) {
  const { allowedRoles = [], requireActiveIdentitySession = false } = options;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: corsHeaders });
    }

    // Service-to-service bypass: if bearer is the service role key, skip auth/role checks
    const rawBearer = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (rawBearer && serviceKey && rawBearer === serviceKey) {
      const admin = createAdminClient();
      const ctx: AuthenticatedRequestContext = {
        user: { id: "service" } as any,
        userId: "service",
        bearer: rawBearer,
        authHeader: `Bearer ${rawBearer}`,
        jwtPayload: {},
        admin,
        caller: admin,
      };
      return await handler(req, ctx);
    }

    const resolved = await resolveAuthenticatedRequest(req, requireActiveIdentitySession);
    if (resolved instanceof Response) return resolved;

    if (allowedRoles.length > 0) {
      const authorized = await hasAnyRole(resolved.admin, resolved.userId, allowedRoles);
      if (!authorized) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
      }
    }

    return await handler(req, resolved);
  };
}