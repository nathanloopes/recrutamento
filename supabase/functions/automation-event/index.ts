// Edge function: write access to automation_events via service_role only.
// Ops:
//   POST { op: "register", event_name, payload } -> { id }
//   POST { op: "mark_processed", id }            -> { ok: true }
// Client (dispatchAutomationEvent) invokes this instead of writing directly.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token)
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = await req.json().catch(() => null) as any
    if (!body || typeof body.op !== 'string') return json({ error: 'invalid_body' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    if (body.op === 'register') {
      const eventName = typeof body.event_name === 'string' ? body.event_name.slice(0, 128) : ''
      if (!eventName) return json({ error: 'event_name_required' }, 400)
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
      const { data, error } = await admin
        .from('automation_events')
        .insert({ event_name: eventName, payload, processed: false })
        .select('id')
        .single()
      if (error) return json({ error: error.message }, 500)
      return json({ id: (data as any).id })
    }

    if (body.op === 'mark_processed') {
      const id = typeof body.id === 'string' ? body.id : ''
      if (!id) return json({ error: 'id_required' }, 400)
      const { error } = await admin
        .from('automation_events')
        .update({ processed: true })
        .eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ error: 'unknown_op' }, 400)
  } catch (err: any) {
    console.error('[automation-event] error', err)
    return json({ error: err?.message || 'internal_error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
