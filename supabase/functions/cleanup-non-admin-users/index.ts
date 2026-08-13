import { corsHeaders } from "../_shared/cors.ts";
import { withAuth, AuthenticatedRequestContext } from "../_shared/with-auth.ts";

interface BatchResult {
  total_pending: number;
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ user_id: string; error: string }>;
  remaining: number;
}

const BATCH_SIZE = 50;
const MAX_BATCHES_PER_CALL = 20; // up to 1000 users / call

const handler = async (_req: Request, ctx: AuthenticatedRequestContext): Promise<Response> => {
  const admin = ctx.admin;

  // Step 1: run public.* purge (idempotent)
  console.log("[cleanup] running execute_cleanup_run_2026_04_30");
  const { error: purgeError } = await admin.rpc("execute_cleanup_run_2026_04_30");
  if (purgeError) {
    console.error("[cleanup] purge error", purgeError);
    return new Response(
      JSON.stringify({ error: "public_purge_failed", details: purgeError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Step 2: load pending auth deletions
  const { count: totalPending } = await admin
    .from("cleanup_run_2026_04_30")
    .select("user_id", { count: "exact", head: true })
    .is("auth_deleted_at", null);

  const result: BatchResult = {
    total_pending: totalPending ?? 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    remaining: totalPending ?? 0,
  };

  for (let batch = 0; batch < MAX_BATCHES_PER_CALL; batch++) {
    const { data: targets, error: loadError } = await admin
      .from("cleanup_run_2026_04_30")
      .select("user_id, email")
      .is("auth_deleted_at", null)
      .limit(BATCH_SIZE);

    if (loadError) {
      console.error("[cleanup] load error", loadError);
      break;
    }
    if (!targets || targets.length === 0) break;

    for (const t of targets) {
      result.attempted++;
      try {
        const { error: delError } = await admin.auth.admin.deleteUser(t.user_id, true);
        if (delError) {
          // "User not found" → treat as success (already gone)
          const msg = delError.message || "";
          if (msg.toLowerCase().includes("not found") || msg.includes("404")) {
            await admin
              .from("cleanup_run_2026_04_30")
              .update({ auth_deleted_at: new Date().toISOString(), auth_delete_error: "user_not_found" })
              .eq("user_id", t.user_id);
            result.succeeded++;
          } else {
            await admin
              .from("cleanup_run_2026_04_30")
              .update({ auth_delete_error: msg })
              .eq("user_id", t.user_id);
            result.failed++;
            result.errors.push({ user_id: t.user_id, error: msg });
          }
        } else {
          await admin
            .from("cleanup_run_2026_04_30")
            .update({ auth_deleted_at: new Date().toISOString(), auth_delete_error: null })
            .eq("user_id", t.user_id);
          result.succeeded++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.failed++;
        result.errors.push({ user_id: t.user_id, error: msg });
        await admin
          .from("cleanup_run_2026_04_30")
          .update({ auth_delete_error: msg })
          .eq("user_id", t.user_id);
      }
    }
  }

  const { count: remaining } = await admin
    .from("cleanup_run_2026_04_30")
    .select("user_id", { count: "exact", head: true })
    .is("auth_deleted_at", null);
  result.remaining = remaining ?? 0;

  await admin.from("activity_logs").insert({
    user_id: ctx.userId,
    action: "cleanup_834_users_auth_batch",
    module: "usuarios_permissoes",
    details: result as unknown as Record<string, unknown>,
  });

  console.log("[cleanup] done", result);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

Deno.serve(withAuth(handler, { allowedRoles: ["admin"] }));
