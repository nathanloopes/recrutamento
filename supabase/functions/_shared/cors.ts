import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const jsonHeaders = {
  "Content-Type": "application/json",
};

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, user-agent, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...jsonHeaders,
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function createAdminClient() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export function createCallerClient(authHeader: string) {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
  });
}

export function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "missing_bearer" }), { status: 401, headers: corsHeaders });
  }
  return authHeader.slice("Bearer ".length);
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid_jwt_payload");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "="));
  return JSON.parse(json);
}
