import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";
import { lookupCep } from "../_shared/cep-lookup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuth(async (req, ctx) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cep, table, record_id, city, state } = await req.json();

    if (!cep && !(city && state)) {
      return new Response(JSON.stringify({ error: "CEP ou cidade/estado obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!table || !record_id) {
      return new Response(JSON.stringify({ error: "table e record_id obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (table !== "profiles" && table !== "candidates" && table !== "units") {
      return new Response(JSON.stringify({ error: "table deve ser 'candidates', 'profiles' ou 'units'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    const { data: isRh } = await supabase.rpc("has_role", { _user_id: ctx.userId, _role: "rh_franqueadora" });

    if ((table === "profiles" || table === "candidates") && record_id !== ctx.userId && !isAdmin && !isRh) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (table === "units" && !isAdmin && !isRh) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use shared robust lookup
    let result = cep ? await lookupCep(cep) : null;

    // If CEP lookup failed or no CEP, try city+state geocoding
    if ((!result || !result.found) && (city || state || result?.city || result?.state)) {
      const fallbackCity = city || result?.city;
      const fallbackState = state || result?.state;
      if (fallbackCity && fallbackState) {
        const { lookupCep: _ , ...mod } = await import("../_shared/cep-lookup.ts");
        // Use Nominatim directly for city/state fallback
        const query = `${fallbackCity}, ${fallbackState}, Brasil`;
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`;
        try {
          const res = await fetch(url, { headers: { "User-Agent": "RecrutaBot/1.0" } });
          if (res.ok) {
            const data = await res.json();
            if (data.length > 0) {
              result = {
                found: true,
                latitude: parseFloat(data[0].lat),
                longitude: parseFloat(data[0].lon),
                city: fallbackCity,
                state: fallbackState,
                source: "nominatim",
              };
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {};

    if (result?.found) {
      if (result.latitude) updatePayload.latitude = result.latitude;
      if (result.longitude) updatePayload.longitude = result.longitude;
    }

    // Fill empty city/state on the record
    const addressSource = result?.found ? result : null;
    if (addressSource) {
      const { data: currentRecord } = await supabase
        .from(table)
        .select("city, state")
        .eq("id", record_id)
        .maybeSingle();

      if (currentRecord) {
        if (!currentRecord.city && addressSource.city) updatePayload.city = addressSource.city;
        if (!currentRecord.state && addressSource.state) updatePayload.state = addressSource.state;
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error } = await supabase.from(table).update(updatePayload).eq("id", record_id);
      if (error) {
        console.error("geocode-cep update error:", error.message);
        return new Response(JSON.stringify({ error: "Failed to update record" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!result?.found) {
      return new Response(
        JSON.stringify({ geocoded: false, error: "Não foi possível geocodificar o endereço" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        geocoded: true,
        latitude: result.latitude || null,
        longitude: result.longitude || null,
        city: result.city || null,
        state: result.state || null,
        neighborhood: result.neighborhood || null,
        street: result.street || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("geocode-cep error:", err);
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
