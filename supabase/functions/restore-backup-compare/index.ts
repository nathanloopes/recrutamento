import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import postgres from 'npm:postgres@3.4.4';
import { createClient } from 'npm:@supabase/supabase-js@2';

const BACKUPS = [
  { name: 'v3', ref: 'fxbbjjuklxfsxdzpmuue', passwordEnv: 'BACKUP_DB_PASSWORD_V3' },
  { name: 'v4', ref: 'ulrmwgtsdtejirqmayzz', passwordEnv: 'BACKUP_DB_PASSWORD_V4' },
];

function hosts(ref: string) {
  return [
    { name: 'direct', host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres' },
    { name: 'pooler-sa', host: 'aws-0-sa-east-1.pooler.supabase.com', port: 6543, user: `postgres.${ref}` },
    { name: 'pooler-us-east', host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543, user: `postgres.${ref}` },
  ];
}

async function connect(ref: string, password: string) {
  const errs: any[] = [];
  for (const h of hosts(ref)) {
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
  throw new Error(JSON.stringify(errs));
}

const safe = async <T,>(fn: () => Promise<T>): Promise<T | { __error: string }> => {
  try { return await fn(); } catch (e: any) { return { __error: e.message }; }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SR_URL = Deno.env.get('SUPABASE_URL')!;
  const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const prod = createClient(SR_URL, SR_KEY);

  // ---- PRODUCTION counts + snapshot ----
  const prodCounts: Record<string, any> = {};
  const TABLES = [
    'candidates', 'applications', 'unit_jobs', 'recruitment_links', 'interviews',
    'application_journey_events', 'interview_feedback', 'document_requests',
    'test_assignments', 'step_responses', 'conversation_threads', 'units',
    'jobs', 'user_roles', 'admin_users', 'candidate_profiles',
  ];
  for (const t of TABLES) {
    const { count, error } = await prod.from(t).select('*', { count: 'exact', head: true });
    prodCounts[t] = error ? { __error: error.message } : count;
  }
  const { data: prodLast } = await prod.from('candidates').select('created_at').order('created_at', { ascending: false }).limit(1);
  const { data: prodLastApp } = await prod.from('applications').select('created_at').order('created_at', { ascending: false }).limit(1);
  const { data: prodLinks } = await prod.from('recruitment_links').select('token,unit_id,unit_job_id,kind,created_at');
  const prodTokens = new Set((prodLinks || []).map(l => l.token));

  // ---- PRODUCTION cpf set (for diff) ----
  const prodCpfs = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await prod.from('candidates').select('cpf').range(offset, offset + 999);
    if (error || !data || data.length === 0) break;
    data.forEach(r => { if (r.cpf) prodCpfs.add(String(r.cpf).replace(/\D/g, '')); });
    if (data.length < 1000) break;
    offset += 1000;
  }

  const out: any = {
    production: {
      counts: prodCounts,
      last_candidate: prodLast?.[0]?.created_at,
      last_application: prodLastApp?.[0]?.created_at,
      total_links: prodLinks?.length || 0,
      distinct_cpfs: prodCpfs.size,
    },
    backups: {} as Record<string, any>,
  };

  for (const b of BACKUPS) {
    const pwd = Deno.env.get(b.passwordEnv);
    if (!pwd) { out.backups[b.name] = { error: `missing ${b.passwordEnv}` }; continue; }
    let sql: any;
    try { const c = await connect(b.ref, pwd); sql = c.sql; }
    catch (e: any) { out.backups[b.name] = { error: 'connect failed', detail: e.message }; continue; }

    try {
      const counts: any = {};
      for (const t of TABLES) {
        const r = await safe(() => sql`SELECT count(*)::int as c FROM ${sql(t)}`);
        counts[t] = (r as any)?.[0]?.c ?? r;
      }
      const last = await safe(() => sql`SELECT max(created_at) as c FROM candidates`);
      const lastApp = await safe(() => sql`SELECT max(created_at) as c FROM applications`);
      const links: any[] = await safe(() => sql`SELECT token, unit_id, unit_job_id, kind, created_at FROM recruitment_links`) as any;

      // CPF diff: backup has, prod doesn't
      const backupCands: any[] = await safe(() => sql`SELECT cpf, full_name, email, created_at, status FROM candidates WHERE cpf IS NOT NULL AND cpf != ''`) as any;
      const missingInProd = Array.isArray(backupCands)
        ? backupCands.filter(c => !prodCpfs.has(String(c.cpf).replace(/\D/g, '')))
        : [];

      const backupTokens = new Set((Array.isArray(links) ? links : []).map((l: any) => l.token));
      const linksMissingInProd = (Array.isArray(links) ? links : []).filter((l: any) => !prodTokens.has(l.token));
      const linksMissingInBackup = (prodLinks || []).filter(l => !backupTokens.has(l.token));

      // Applications: count + most recent
      const appsBackup: any = await safe(() => sql`SELECT count(*)::int as total,
        count(*) FILTER (WHERE status = 'contratado')::int as contratados,
        count(*) FILTER (WHERE status = 'em_andamento')::int as em_andamento,
        count(*) FILTER (WHERE status = 'standby')::int as standby
        FROM applications`);

      await sql.end();

      out.backups[b.name] = {
        counts,
        last_candidate: (last as any)?.[0]?.c,
        last_application: (lastApp as any)?.[0]?.c,
        applications_breakdown: (appsBackup as any)?.[0],
        diff_vs_prod: {
          backup_total_candidates: Array.isArray(backupCands) ? backupCands.length : null,
          candidates_missing_in_prod: missingInProd.length,
          sample_missing_candidates: missingInProd.slice(0, 30),
          links_missing_in_prod: linksMissingInProd.length,
          sample_links_missing_in_prod: linksMissingInProd.slice(0, 20),
          links_missing_in_backup: linksMissingInBackup.length,
          sample_links_missing_in_backup: linksMissingInBackup.slice(0, 20),
        },
      };
    } catch (e: any) {
      try { await sql.end(); } catch {}
      out.backups[b.name] = { error: e.message };
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
