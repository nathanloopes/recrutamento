import { corsHeaders, createAdminClient } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

/**
 * Google Calendar Sync Edge Function
 * 
 * Supports two operations:
 * 1. "sync_event" - Create/update a calendar event when an interview is scheduled
 * 2. "delete_event" - Remove a calendar event when an interview is cancelled
 * 3. "list_events" - List upcoming calendar events for a unit
 * 
 * Requires GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN
 * to be set in Supabase Edge Function secrets.
 */

Deno.serve(withAuth(async (req) => {
  try {
    const supabase = createAdminClient();

    // Check if calendar sync is enabled
    const { data: settings } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "interview_audit")
      .eq("key", "enable_calendar_sync")
      .single();

    const syncEnabled = settings?.value === true || settings?.value === "true";
    if (!syncEnabled) {
      return new Response(JSON.stringify({ error: "Google Calendar sync is disabled" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_CALENDAR_REFRESH_TOKEN");

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      return new Response(JSON.stringify({ 
        error: "Google Calendar credentials not configured",
        setup_required: true,
        instructions: "Configure GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, and GOOGLE_CALENDAR_REFRESH_TOKEN in Edge Function secrets.",
      }), {
        status: 500, headers: corsHeaders,
      });
    }

    // Get access token from refresh token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      console.error("Failed to get Google access token:", tokenData);
      return new Response(JSON.stringify({ error: "Failed to authenticate with Google" }), {
        status: 502, headers: corsHeaders,
      });
    }

    const accessToken = tokenData.access_token;
    const { action, interview_id, calendar_id } = await req.json();
    const calId = calendar_id || "primary";

    if (action === "sync_event") {
      // Fetch interview details
      const { data: interview, error: intErr } = await supabase
        .from("interviews")
        .select("*, profiles(full_name, email), units(name, city, state), applications(unit_job_id, unit_jobs(jobs(title)))")
        .eq("id", interview_id)
        .single();
      if (intErr || !interview) {
        return new Response(JSON.stringify({ error: "Interview not found" }), {
          status: 404, headers: corsHeaders,
        });
      }

      const candidateName = (interview.profiles as any)?.full_name || "Candidato";
      const unitName = (interview.units as any)?.name || "";
      const jobTitle = (interview.applications as any)?.unit_jobs?.jobs?.title || "";

      // Load timezone from settings
      const { data: tzSetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "calendar")
        .eq("key", "timezone_default")
        .single();
      const timezone = (typeof tzSetting?.value === "string" ? tzSetting.value.replace(/"/g, "") : null) || "America/Sao_Paulo";

      const { data: durationSetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "calendar")
        .eq("key", "default_interview_duration")
        .single();
      const durationMinutes = Number(durationSetting?.value) || 30;

      const startDateTime = `${interview.scheduled_date}T${interview.scheduled_time}`;
      const startDate = new Date(startDateTime);
      const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

      const event = {
        summary: `Entrevista: ${candidateName} — ${jobTitle}`,
        description: `Candidato: ${candidateName}\nCargo: ${jobTitle}\nUnidade: ${unitName}\nModalidade: ${interview.modality}\n\nAgendado via Recruta.`,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: timezone,
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: timezone,
        },
        ...(interview.modality === "online" && interview.meeting_link ? {
          conferenceData: {
            entryPoints: [{ entryPointType: "video", uri: interview.meeting_link }],
          },
        } : {}),
      };

      const gcalResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
      );

      const gcalResult = await gcalResponse.json();
      if (!gcalResponse.ok) {
        console.error("Google Calendar API error:", gcalResult);
        return new Response(JSON.stringify({ error: "Failed to create calendar event", details: gcalResult }), {
          status: 502, headers: corsHeaders,
        });
      }

      // Log integration
      await supabase.from("integration_logs").insert({
        integration_id: null,
        event: "google_calendar_sync",
        success: true,
        context: { interview_id, google_event_id: gcalResult.id, action: "create" },
      } as any);

      return new Response(JSON.stringify({ 
        success: true, 
        google_event_id: gcalResult.id,
        html_link: gcalResult.htmlLink,
      }), { status: 200, headers: corsHeaders });
    }

    if (action === "delete_event") {
      const { google_event_id } = await req.json();
      if (!google_event_id) {
        return new Response(JSON.stringify({ error: "google_event_id required" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const gcalResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${google_event_id}`,
        {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${accessToken}` },
        }
      );

      await supabase.from("integration_logs").insert({
        event: "google_calendar_sync",
        success: gcalResponse.ok,
        context: { interview_id, google_event_id, action: "delete" },
      } as any);

      return new Response(JSON.stringify({ success: gcalResponse.ok }), {
        status: 200, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use: sync_event, delete_event" }), {
      status: 400, headers: corsHeaders,
    });
  } catch (err) {
    console.error("google-calendar-sync error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: corsHeaders,
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
