import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const DEBOUNCE_MINUTES = 2;

async function getRecipients(unitId: string | null): Promise<string[]> {
  const ids: string[] = [];
  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  ids.push(...(admins || []).map((r: any) => r.user_id));

  const otherRoles = ["franqueado", "rh_franqueadora", "gestor_recrutamento"];
  if (unitId) {
    const { data: unitRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("unit_id", unitId)
      .in("role", otherRoles);
    ids.push(...(unitRoles || []).map((r: any) => r.user_id));
  }
  const { data: redeRoles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("scope_access", "rede")
    .in("role", otherRoles);
  ids.push(...(redeRoles || []).map((r: any) => r.user_id));

  return [...new Set(ids)];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Auth gate ──
  const serviceKey = SERVICE_ROLE;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authorized = !!bearer && bearer === serviceKey;
  if (!authorized && bearer && bearer !== anonKey) {
    const userClient = createClient(SUPABASE_URL, anonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
    const { data, error } = await userClient.auth.getUser();
    authorized = !!data?.user && !error;
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  try {
    const { request_id, document_type } = await req.json();
    if (!request_id || !document_type) {
      return new Response(JSON.stringify({ error: "request_id and document_type required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve context
    const { data: docReq } = await supabase
      .from("document_requests")
      .select("id, application_id, unit_id, candidate_id")
      .eq("id", request_id)
      .single();

    if (!docReq) {
      return new Response(JSON.stringify({ error: "request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let unitId: string | null = (docReq as any).unit_id || null;
    let candidateId: string | null = (docReq as any).candidate_id || null;
    let jobTitle = "";

    if (docReq.application_id) {
      const { data: app } = await supabase
        .from("applications")
        .select("candidate_id, unit_job_id, unit_jobs:unit_job_id(unit_id, title, jobs:job_id(title))")
        .eq("id", docReq.application_id)
        .single();
      if (app) {
        candidateId = candidateId || (app as any).candidate_id;
        unitId = unitId || (app as any).unit_jobs?.unit_id || null;
        jobTitle = (app as any).unit_jobs?.title || (app as any).unit_jobs?.jobs?.title || "";
      }
    }

    let candidateName = "Um candidato";
    if (candidateId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", candidateId)
        .single();
      if (prof?.full_name) candidateName = prof.full_name;
    }

    const recipients = await getRecipients(unitId);
    const sinceIso = new Date(Date.now() - DEBOUNCE_MINUTES * 60 * 1000).toISOString();

    let inserted = 0;
    let merged = 0;

    for (const rid of recipients) {
      if (rid === candidateId) continue;

      // Find recent pending notification for same application+recipient
      const { data: existing } = await supabase
        .from("notifications")
        .select("id, payload, body")
        .eq("recipient_id", rid)
        .eq("event_type", "document_uploaded")
        .eq("status", "pending")
        .gte("created_at", sinceIso)
        .filter("payload->>application_id", "eq", docReq.application_id || "")
        .order("created_at", { ascending: false })
        .limit(1);

      const last = existing && existing[0];

      if (last) {
        const prev = (last.payload || {}) as any;
        const docs: string[] = Array.isArray(prev.docs) ? [...prev.docs] : [];
        if (!docs.includes(document_type)) docs.push(document_type);
        const count = docs.length;
        const body = `${candidateName} enviou ${count} documento${count > 1 ? "s" : ""} para análise${jobTitle ? ` — ${jobTitle}` : ""}.`;

        await supabase
          .from("notifications")
          .update({
            body,
            payload: { ...prev, docs, count, last_document: document_type },
          })
          .eq("id", last.id);
        merged++;
      } else {
        const body = `${candidateName} enviou 1 documento para análise${jobTitle ? ` — ${jobTitle}` : ""}.`;
        await supabase.from("notifications").insert({
          event_type: "document_uploaded",
          recipient_id: rid,
          channel: "push",
          title: "Novo documento para análise",
          body,
          status: "pending",
          action_url: "/admin/documentacao",
          action_type: "action_required",
          payload: {
            application_id: docReq.application_id,
            request_id,
            candidate_id: candidateId,
            candidate_name: candidateName,
            job_title: jobTitle,
            docs: [document_type],
            count: 1,
          },
        } as any);
        inserted++;
      }
    }

    return new Response(JSON.stringify({ ok: true, inserted, merged, recipients: recipients.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("notify-document-uploaded error:", e);
    return new Response(JSON.stringify({ error: e?.message || "internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
