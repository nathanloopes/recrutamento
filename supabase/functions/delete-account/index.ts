// Soft-delete: desativa a conta no backend mas o frontend mostra como exclusão.
// Mantém auth.users, candidates, candidate_profiles e todos os dados intactos.
// Reativação acontece via check-cpf-reactivation quando o mesmo CPF se cadastra
// novamente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "missing_authorization", stage: "auth" }), {
        status: 401, headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: "invalid_token", stage: "auth" }), {
        status: 401, headers: corsHeaders,
      });
    }

    const userId = user.id;
    const admin = createClient(supabaseUrl, serviceKey);

    console.log(`[delete-account] Soft-deactivating user=${userId}`);

    // 1) Desativa candidate (mantém todos os dados)
    const { error: candErr } = await admin
      .from("candidates")
      .update({
        is_active: false,
        user_status: "arquivado",
        status_reason: "self_deactivated",
        status_changed_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (candErr) {
      // Pode não existir registro em candidates (admin sem candidate row).
      // Não bloqueia — segue para sessões.
      console.warn(`[delete-account] warn candidates update: ${candErr.message}`);
    }

    // 2) Revoga sessões identity (defesa em profundidade)
    const { error: sessErr } = await admin
      .from("identity_sessions")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .neq("status", "revoked");
    if (sessErr) console.warn(`[delete-account] warn identity_sessions: ${sessErr.message}`);

    // 3) Activity log
    try {
      await admin.from("activity_logs").insert({
        user_id: userId,
        action: "account_self_deactivated",
        entity_type: "candidate",
        entity_id: userId,
        metadata: { reason: "user_request" },
      } as any);
    } catch (e: any) {
      console.warn(`[delete-account] warn activity_logs: ${e?.message}`);
    }

    // 4) Sign-out global no auth (invalida todos os refresh tokens)
    try {
      await admin.auth.admin.signOut(userId, "global");
    } catch (e: any) {
      console.warn(`[delete-account] warn auth signOut: ${e?.message}`);
    }

    console.log(`[delete-account] SUCCESS soft-deactivated user=${userId}`);

    return new Response(JSON.stringify({ success: true, deleted_id: userId }), {
      status: 200, headers: corsHeaders,
    });
  } catch (error: any) {
    console.error("[delete-account] error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || "internal_error",
      stage: error?.stage || "unknown",
    }), { status: 500, headers: corsHeaders });
  }
});
