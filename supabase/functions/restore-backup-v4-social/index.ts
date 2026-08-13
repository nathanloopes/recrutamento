import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import postgres from 'npm:postgres@3.4.4';

const REF = 'ulrmwgtsdtejirqmayzz';
const HOSTS = [
  { name: 'direct', host: `db.${REF}.supabase.co`, port: 5432, user: 'postgres' },
  { name: 'pooler-sa', host: 'aws-0-sa-east-1.pooler.supabase.com', port: 6543, user: `postgres.${REF}` },
];

async function connect(password: string) {
  const errs: any[] = [];
  for (const h of HOSTS) {
    try {
      const sql = postgres({ host: h.host, port: h.port, user: h.user, password, database: 'postgres', ssl: 'require', max: 1, idle_timeout: 5, connect_timeout: 10 });
      await sql`SELECT 1`;
      return { sql, used: h.name };
    } catch (e: any) { errs.push({ host: h.name, error: e.message }); }
  }
  throw new Error(JSON.stringify({ tried: errs }));
}

const safe = async <T,>(fn: () => Promise<T>) => { try { return await fn(); } catch (e: any) { return { __error: e.message }; } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const password = Deno.env.get('BACKUP_DB_PASSWORD_V4');
  if (!password) return new Response(JSON.stringify({ error: 'missing pw' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let sql: any, used = '';
  try { const c = await connect(password); sql = c.sql; used = c.used; }
  catch (e: any) { return new Response(JSON.stringify({ error: 'connect', detail: e.message }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  try {
    // 1. Procurar jobs SOCIAL MEDIA (cargo)
    const socialJobs = await safe(() => sql`
      SELECT id, title, slug, status, created_at FROM jobs
      WHERE title ILIKE '%social%' OR title ILIKE '%mídia%' OR title ILIKE '%midia%'
      ORDER BY title`);

    // 2. Todas unit_jobs para esses cargos (em qualquer unidade)
    const socialUnitJobs = await safe(() => sql`
      SELECT uj.id, uj.job_id, uj.unit_id, uj.status, uj.created_at, uj.updated_at,
             j.title as job_title, u.name as unit_name
      FROM unit_jobs uj
      JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      WHERE j.title ILIKE '%social%' OR j.title ILIKE '%mídia%' OR j.title ILIKE '%midia%'
      ORDER BY uj.created_at DESC`);

    // 3. Giovanna - candidato
    const giovanna = await safe(() => sql`
      SELECT id, full_name, cpf, email, phone, status, created_at, updated_at
      FROM candidates
      WHERE full_name ILIKE '%giovanna%' OR full_name ILIKE '%giammarino%'
         OR email ILIKE '%giovannag%' OR email ILIKE '%giammarino%'
         OR cpf = '40371243866'
      ORDER BY created_at DESC`);

    // 4. Todas applications da Giovanna (todas vagas)
    const giovannaApps = await safe(() => sql`
      SELECT a.id, a.candidate_id, a.unit_job_id, a.status, a.created_at, a.updated_at,
             c.full_name, c.cpf,
             j.title as job_title, u.name as unit_name
      FROM applications a
      LEFT JOIN candidates c ON c.id = a.candidate_id
      LEFT JOIN unit_jobs uj ON uj.id = a.unit_job_id
      LEFT JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      WHERE c.full_name ILIKE '%giovanna%' OR c.full_name ILIKE '%giammarino%'
         OR c.email ILIKE '%giovannag%' OR c.cpf = '40371243866'
      ORDER BY a.created_at DESC`);

    // 5. Recruitment links das vagas SOCIAL MEDIA + clicks
    const socialLinks = await safe(() => sql`
      SELECT rl.id, rl.token, rl.short_code, rl.label, rl.campaign, rl.channel,
             rl.clicks_count, rl.applications_count, rl.is_active,
             rl.unit_job_id, rl.created_at, rl.deactivated_at,
             j.title as job_title, u.name as unit_name
      FROM recruitment_links rl
      LEFT JOIN unit_jobs uj ON uj.id = rl.unit_job_id
      LEFT JOIN jobs j ON j.id = uj.job_id OR j.id = rl.job_id
      LEFT JOIN units u ON u.id = uj.unit_id OR u.id = rl.unit_id
      WHERE (j.title ILIKE '%social%' OR j.title ILIKE '%mídia%' OR j.title ILIKE '%midia%')
      ORDER BY rl.created_at DESC`);

    // 6. TESTES DO MAKE unit (ea6421d6) - todas applications + outras unit_jobs nessa unidade
    const makeUnitJobs = await safe(() => sql`
      SELECT uj.id, uj.job_id, uj.unit_id, uj.status, uj.created_at,
             j.title as job_title, u.name as unit_name
      FROM unit_jobs uj
      LEFT JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      WHERE uj.unit_id = '9233e925-4c6a-4a32-ac5d-0146fcb058a9'
      ORDER BY uj.created_at DESC`);

    // 7. Applications no unit_job ea6421d6 (TESTES DO MAKE / VENDEDOR) - era a "SOCIAL MEDIA"
    const ea6421Apps = await safe(() => sql`
      SELECT a.id, a.candidate_id, a.status, a.created_at, a.updated_at,
             c.full_name, c.cpf, c.email, c.phone
      FROM applications a
      LEFT JOIN candidates c ON c.id = a.candidate_id
      WHERE a.unit_job_id = 'ea6421d6-9d2c-4450-a1d2-f33461940b52'
      ORDER BY a.created_at DESC`);

    // 8. Recruitment links na unidade TESTES DO MAKE
    const makeLinks = await safe(() => sql`
      SELECT rl.id, rl.token, rl.short_code, rl.label, rl.campaign, rl.channel,
             rl.clicks_count, rl.applications_count, rl.is_active,
             rl.unit_job_id, rl.created_at, rl.deactivated_at,
             j.title as job_title, u.name as unit_name
      FROM recruitment_links rl
      LEFT JOIN unit_jobs uj ON uj.id = rl.unit_job_id
      LEFT JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      WHERE rl.unit_id = '9233e925-4c6a-4a32-ac5d-0146fcb058a9'
         OR uj.unit_id = '9233e925-4c6a-4a32-ac5d-0146fcb058a9'
      ORDER BY rl.created_at DESC`);

    await sql.end();
    return new Response(JSON.stringify({
      used_host: used,
      social_media_jobs: socialJobs,
      social_media_unit_jobs: socialUnitJobs,
      social_media_recruitment_links: socialLinks,
      giovanna_candidate: giovanna,
      giovanna_applications: giovannaApps,
      testes_do_make_unit_jobs: makeUnitJobs,
      testes_do_make_recruitment_links: makeLinks,
      applications_in_ea6421d6: ea6421Apps,
    }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    try { await sql.end(); } catch {}
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
