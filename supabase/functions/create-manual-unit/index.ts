import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  name: z.string().trim().min(2).max(200),
  code: z.string().trim().min(1).max(50),
  city: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(2).optional().nullable(),
  company_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return json({ error: "unauthorized" }, 401);
    }

    // Authenticate user
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check role: admin only
    const { data: roleCheck } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!roleCheck) return json({ error: "forbidden", message: "Apenas administradores." }, 403);

    // Check feature flag
    const { data: flag } = await admin
      .from("global_settings")
      .select("value")
      .eq("category", "units")
      .eq("key", "allow_manual_unit_create")
      .maybeSingle();
    const enabled = flag?.value === true || flag?.value === "true";
    if (!enabled) {
      return json({ error: "feature_disabled", message: "Cadastro manual de unidades está desativado." }, 403);
    }

    // Validate body
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_payload", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    const normalizedCode = body.code.trim().toUpperCase();

    // Duplicate check (case-insensitive)
    const { data: existing } = await admin
      .from("units")
      .select("id")
      .ilike("code", normalizedCode)
      .maybeSingle();
    if (existing) {
      return json({ error: "duplicate_code", message: "Já existe uma unidade com este código." }, 409);
    }

    // Insert
    const { data: inserted, error: insErr } = await admin
      .from("units")
      .insert({
        name: body.name.trim(),
        code: normalizedCode,
        city: body.city || null,
        state: body.state ? body.state.toUpperCase() : null,
        company_id: body.company_id || null,
        is_active: body.is_active ?? true,
        origem_unidade: "MANUAL",
      })
      .select("id, name, code, city, state, is_active, origem_unidade")
      .single();

    if (insErr) {
      console.error("[create-manual-unit] insert error:", insErr);
      return json({ error: "insert_failed", message: insErr.message }, 500);
    }

    // Audit log (best-effort)
    await admin.from("activity_logs").insert({
      user_id: userData.user.id,
      action: "unit_manual_created",
      module: "unidades",
      details: {
        unit_id: inserted.id,
        code: inserted.code,
        name: inserted.name,
      },
    });

    return json({ success: true, unit: inserted }, 201);
  } catch (err) {
    console.error("[create-manual-unit] unexpected:", err);
    return json({ error: "internal_error", message: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
