// Diagnóstico temporário do Brevo. Retorna status da conta, créditos e domínios validados.
// Remover após diagnóstico concluído.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function brevoGet(path: string, key: string) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    headers: { "api-key": key, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
  if (!BREVO_API_KEY) {
    return new Response(
      JSON.stringify({ error: "BREVO_API_KEY não configurado" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const [account, senders, domains] = await Promise.all([
      brevoGet("/account", BREVO_API_KEY),
      brevoGet("/senders", BREVO_API_KEY),
      brevoGet("/senders/domains", BREVO_API_KEY),
    ]);

    return new Response(
      JSON.stringify(
        {
          key_valid: account.status === 200,
          account: {
            status: account.status,
            email: account.body?.email ?? null,
            companyName: account.body?.companyName ?? null,
            plan: account.body?.plan ?? null,
            error: account.status !== 200 ? account.body : undefined,
          },
          senders: {
            status: senders.status,
            list:
              Array.isArray(senders.body?.senders)
                ? senders.body.senders.map((s: any) => ({
                    email: s.email,
                    name: s.name,
                    active: s.active,
                  }))
                : senders.body,
          },
          domains: {
            status: domains.status,
            list:
              Array.isArray(domains.body?.domains)
                ? domains.body.domains.map((d: any) => ({
                    domain: d.domain,
                    authenticated: d.authenticated,
                    verified: d.verified,
                    dkim: d.dkim,
                    dmarc: d.dmarc,
                  }))
                : domains.body,
          },
        },
        null,
        2,
      ),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("test-brevo-health error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
