import { corsHeaders, createAdminClient } from "../_shared/cors.ts";

// Coletor de violações de Content-Security-Policy (report-uri / Reporting API).
//
// Endpoint PÚBLICO (verify_jwt = false): navegadores fazem POST sem token.
// FAIL-SAFE: nunca devolve erro ao cliente — sempre responde 204, mesmo em
// falha de parse ou de insert. Erros são só logados (console.error).

type Row = {
  document_uri: string | null;
  referrer: string | null;
  violated_directive: string | null;
  effective_directive: string | null;
  blocked_uri: string | null;
  source_file: string | null;
  line_number: number | null;
  column_number: number | null;
  disposition: string | null;
  raw: unknown;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

// Normaliza ambos os formatos numa lista de linhas da tabela.
function normalizeReports(payload: unknown): Row[] {
  // application/reports+json → array de { type: "csp-violation", body: {...} }
  if (Array.isArray(payload)) {
    return payload
      .filter((r) => r && typeof r === "object")
      .map((r) => {
        const body = ((r as Record<string, unknown>).body ?? {}) as Record<string, unknown>;
        return {
          document_uri: str(body["documentURL"]),
          referrer: null,
          violated_directive: null,
          effective_directive: str(body["effectiveDirective"]),
          blocked_uri: str(body["blockedURL"]),
          source_file: str(body["sourceFile"]),
          line_number: toInt(body["lineNumber"]),
          column_number: toInt(body["columnNumber"]),
          disposition: str(body["disposition"]),
          raw: r,
        };
      });
  }

  // application/csp-report → { "csp-report": {...} }
  if (payload && typeof payload === "object") {
    const report = (payload as Record<string, unknown>)["csp-report"];
    if (report && typeof report === "object") {
      const r = report as Record<string, unknown>;
      return [{
        document_uri: str(r["document-uri"]),
        referrer: str(r["referrer"]),
        violated_directive: str(r["violated-directive"]),
        effective_directive: str(r["effective-directive"]),
        blocked_uri: str(r["blocked-uri"]),
        source_file: str(r["source-file"]),
        line_number: toInt(r["line-number"]),
        column_number: toInt(r["column-number"]),
        disposition: str(r["disposition"]),
        raw: payload,
      }];
    }
  }

  return [];
}

Deno.serve(async (req) => {
  // Preflight CORS.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Só aceita POST; qualquer outro método → 405.
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  // Fail-safe: engole qualquer erro e sempre responde 204.
  try {
    const userAgent = req.headers.get("user-agent");
    const payload = await req.json();
    const rows = normalizeReports(payload);

    if (rows.length > 0) {
      const supabase = createAdminClient();
      const { error } = await supabase
        .from("csp_violations")
        .insert(rows.map((r) => ({ ...r, user_agent: userAgent })));
      if (error) console.error("[csp-report] insert error:", error.message);
    }
  } catch (err) {
    console.error("[csp-report] error:", err);
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
