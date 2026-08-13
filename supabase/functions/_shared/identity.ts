import { SignJWT } from "https://esm.sh/jose@5.9.6";
import { createAdminClient } from "./cors.ts";

// Re-export basic utilities from cors.ts for backward compatibility
export { corsHeaders, jsonHeaders, createAdminClient, createCallerClient, getBearerToken, decodeJwtPayload } from "./cors.ts";

export type IdentityClientType = "web" | "mobile" | "api" | "integration";

export interface DevicePayload {
  device_seed: string;
  device_label?: string;
  platform?: string;
  user_agent?: string;
  language?: string;
  timezone?: string;
  screen?: string;
  app_version?: string;
  fingerprint_version?: number;
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashWithPepper(input: string): Promise<string> {
  return sha256Hex(`${getRequiredEnv("IDENTITY_PEPPER")}:${input}`);
}

export function randomBase64Url(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function getIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "0.0.0.0";
  return forwarded.split(",")[0].trim();
}

export async function buildDeviceHashes(payload: DevicePayload) {
  const normalizedUserAgent = String(payload.user_agent || "unknown").trim().toLowerCase();
  const fingerprintBase = [
    payload.device_seed,
    normalizedUserAgent,
    payload.platform || "unknown",
    payload.language || "unknown",
    payload.timezone || "unknown",
    payload.screen || "unknown",
    payload.app_version || "unknown",
  ].join("|");

  return {
    deviceSeedHash: await hashWithPepper(payload.device_seed),
    fingerprintHash: await hashWithPepper(fingerprintBase),
    userAgentHash: await hashWithPepper(normalizedUserAgent),
  };
}

export async function deriveBrowserName(userAgent: string | undefined) {
  const ua = String(userAgent || "").toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("chrome/")) return "chrome";
  if (ua.includes("firefox/")) return "firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "safari";
  return "unknown";
}

export async function deriveOsName(userAgent: string | undefined, platform: string | undefined) {
  const combined = `${platform || ""} ${userAgent || ""}`.toLowerCase();
  if (combined.includes("windows")) return "windows";
  if (combined.includes("android")) return "android";
  if (combined.includes("iphone") || combined.includes("ipad") || combined.includes("ios")) return "ios";
  if (combined.includes("mac")) return "macos";
  if (combined.includes("linux")) return "linux";
  return "unknown";
}

export async function logIdentityEvent(admin: ReturnType<typeof createAdminClient>, params: {
  userId?: string | null;
  sessionId?: string | null;
  deviceId?: string | null;
  eventType: string;
  ipHash?: string | null;
  userAgentHash?: string | null;
  riskScore?: number;
  details?: Record<string, unknown>;
}) {
  await admin.from("identity_audit_logs").insert({
    user_id: params.userId || null,
    session_id: params.sessionId || null,
    device_id: params.deviceId || null,
    event_type: params.eventType,
    ip_hash: params.ipHash || null,
    user_agent_hash: params.userAgentHash || null,
    risk_score: params.riskScore ?? 0,
    details: params.details || {},
  });
}

export async function issueDelegatedAccessToken(input: {
  userId: string;
  sessionId: string;
  deviceId: string;
  audience: string;
  scopes: string[];
  clientType: IdentityClientType;
}) {
  const secret = new TextEncoder().encode(getRequiredEnv("IDENTITY_JWT_SECRET"));
  return await new SignJWT({
    scp: input.scopes,
    did: input.deviceId,
    sid: input.sessionId,
    typ: "delegated_access",
    client_type: input.clientType,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("recrutamento-web")
    .setAudience(input.audience)
    .setSubject(input.userId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function verifyPkce(codeVerifier: string, codeChallenge: string) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const encoded = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return encoded === codeChallenge;
}

export async function revokeSessionFamily(admin: ReturnType<typeof createAdminClient>, sessionId: string, familyId?: string | null, reason = "refresh_replay_detected") {
  await admin.rpc("identity_revoke_session", { _session_id: sessionId, _reason: reason });
  if (familyId) {
    await admin.from("identity_refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("refresh_family_id", familyId)
      .is("revoked_at", null);
  }
}
