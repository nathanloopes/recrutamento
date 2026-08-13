import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import postgres from 'npm:postgres@3.4.4';

const REF = 'xymthdrrmxdkvajgwatt';
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
  const password = Deno.env.get('BACKUP_DB_PASSWORD_V2');
  if (!password) return new Response(JSON.stringify({ error: 'missing BACKUP_DB_PASSWORD_V2' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let sql: any, used = '';
  try {
    const c = await connect(password); sql = c.sql; used = c.used;
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'connect failed', detail: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      (SELECT count(*) FROM recruitment_links) as total_links`);

    // SOCIAL MEDIA unit_job
    const socialJob = await safe(() => sql`SELECT * FROM unit_jobs WHERE id='ea6421d6-9d2c-4450-a1d2-f33461940b52'`);
    const socialJobByTitle = await safe(() => sql`SELECT id, job_id, unit_id, status, created_at FROM unit_jobs WHERE id::text ILIKE 'ea6421d6%' OR job_id IN (SELECT id FROM jobs WHERE title ILIKE '%social%media%' OR title ILIKE '%mídia%social%')`);

    // Giovanna
    const giovanna = await safe(() => sql`SELECT id, full_name, cpf, email, phone, created_at, status FROM candidates WHERE full_name ILIKE '%giovanna%' OR full_name ILIKE '%giammarino%' OR email ILIKE '%giammarino%' OR email ILIKE '%giovannag%' ORDER BY created_at DESC`);

    // Apps on SOCIAL MEDIA
    const apps = await safe(() => sql`SELECT a.id, a.candidate_id, a.status, a.score, a.created_at, a.updated_at, c.full_name, c.email, c.cpf, c.phone FROM applications a LEFT JOIN candidates c ON c.id=a.candidate_id WHERE a.unit_job_id='ea6421d6-9d2c-4450-a1d2-f33461940b52' ORDER BY a.created_at DESC`);

    // Interviews on SOCIAL MEDIA
    const interviews = await safe(() => sql`SELECT i.* FROM interviews i JOIN applications a ON a.id=i.application_id WHERE a.unit_job_id='ea6421d6-9d2c-4450-a1d2-f33461940b52' ORDER BY i.created_at DESC`);

    // Journey events
    const journey = await safe(() => sql`SELECT count(*) FROM application_journey_events e JOIN applications a ON a.id=e.application_id WHERE a.unit_job_id='ea6421d6-9d2c-4450-a1d2-f33461940b52'`);

    // Recruitment links
    const links = await safe(() => sql`SELECT * FROM recruitment_links WHERE unit_job_id='ea6421d6-9d2c-4450-a1d2-f33461940b52'`);

    // Activity log da exclusão (caso ainda esteja antes do snapshot)
    const exclLog = await safe(() => sql`SELECT * FROM activity_logs WHERE action ILIKE '%vaga_corporativa_excluida%' OR (metadata::text ILIKE '%ea6421d6%') ORDER BY created_at DESC LIMIT 10`);

    await sql.end();
    return new Response(JSON.stringify({
      used_host: used, snapshot, socialJob, socialJobByTitle,
      giovanna, apps, interviews, journey, links, exclLog,
    }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    try { await sql.end(); } catch {}
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
