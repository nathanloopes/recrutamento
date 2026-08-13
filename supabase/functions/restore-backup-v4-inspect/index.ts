import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import postgres from 'npm:postgres@3.4.4';

const REF = 'ulrmwgtsdtejirqmayzz';
const HOSTS = [
  { name: 'direct', host: `db.${REF}.supabase.co`, port: 5432, user: 'postgres' },
  { name: 'pooler-sa', host: 'aws-0-sa-east-1.pooler.supabase.com', port: 6543, user: `postgres.${REF}` },
  { name: 'pooler-us-east', host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543, user: `postgres.${REF}` },
  { name: 'pooler-us-west', host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543, user: `postgres.${REF}` },
];

async function connect(password: string) {
  const errs: any[] = [];
  for (const h of HOSTS) {
    try {
      const sql = postgres({
        host: h.host, port: h.port, user: h.user, password,
        database: 'postgres', ssl: 'require',
        max: 1, idle_timeout: 5, connect_timeout: 10,
      });
      await sql`SELECT 1`;
      return { sql, used: h.name };
    } catch (e: any) {
      errs.push({ host: h.name, error: e.message });
    }
  }
  throw new Error(JSON.stringify({ tried: errs }));
}

const safe = async <T,>(fn: () => Promise<T>): Promise<T | { __error: string }> => {
  try { return await fn(); } catch (e: any) { return { __error: e.message }; }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const password = Deno.env.get('BACKUP_DB_PASSWORD_V4');
  if (!password) return new Response(JSON.stringify({ error: 'missing BACKUP_DB_PASSWORD_V4' }), {
    status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  let sql: any, used = '';
  try {
    const c = await connect(password); sql = c.sql; used = c.used;
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'connect failed', detail: e.message }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const snapshot = await safe(() => sql`SELECT now() as db_now,
      (SELECT max(created_at) FROM candidates) as last_candidate,
      (SELECT max(created_at) FROM applications) as last_app,
      (SELECT max(created_at) FROM activity_logs) as last_activity,
      (SELECT count(*) FROM candidates) as total_candidates,
      (SELECT count(*) FROM applications) as total_applications,
      (SELECT count(*) FROM unit_jobs) as total_unit_jobs,
      (SELECT count(*) FROM interviews) as total_interviews,
      (SELECT count(*) FROM recruitment_links) as total_links,
      (SELECT count(*) FROM application_journey_events) as total_journey,
      (SELECT count(*) FROM interview_feedback) as total_feedback,
      (SELECT count(*) FROM document_requests) as total_doc_requests,
      (SELECT count(*) FROM test_assignments) as total_test_assignments,
      (SELECT count(*) FROM step_responses) as total_step_responses,
      (SELECT count(*) FROM conversation_threads) as total_threads`);

    const unitJobs = await safe(() => sql`
      SELECT uj.id, uj.job_id, uj.unit_id, uj.status, uj.created_at,
             j.title as job_title, u.name as unit_name
      FROM unit_jobs uj
      LEFT JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      ORDER BY uj.created_at DESC`);

    const recentCandidates = await safe(() => sql`
      SELECT id, full_name, cpf, email, phone, created_at, status
      FROM candidates ORDER BY created_at DESC LIMIT 50`);

    const recentApps = await safe(() => sql`
      SELECT a.id, a.candidate_id, a.unit_job_id, a.status, a.created_at, a.updated_at,
             c.full_name, c.cpf, c.email,
             j.title as job_title, u.name as unit_name
      FROM applications a
      LEFT JOIN candidates c ON c.id = a.candidate_id
      LEFT JOIN unit_jobs uj ON uj.id = a.unit_job_id
      LEFT JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      ORDER BY a.created_at DESC LIMIT 50`);

    const links = await safe(() => sql`
      SELECT rl.*, j.title as job_title, u.name as unit_name
      FROM recruitment_links rl
      LEFT JOIN unit_jobs uj ON uj.id = rl.unit_job_id
      LEFT JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      ORDER BY rl.created_at DESC LIMIT 50`);

    const exclLogs = await safe(() => sql`
      SELECT created_at, user_id, action
      FROM activity_logs
      WHERE action ILIKE '%excluida%' OR action ILIKE '%delete%' OR action ILIKE '%restore%'
         OR action ILIKE '%remov%'
      ORDER BY created_at DESC LIMIT 20`);

    await sql.end();
    return new Response(JSON.stringify({
      used_host: used,
      snapshot,
      unit_jobs: unitJobs,
      recent_candidates: recentCandidates,
      recent_applications: recentApps,
      recruitment_links: links,
      deletion_logs: exclLogs,
    }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    try { await sql.end(); } catch {}
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
