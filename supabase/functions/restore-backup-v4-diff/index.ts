import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import postgres from 'npm:postgres@3.4.4';
import { createClient } from 'npm:@supabase/supabase-js@2';

const REF = 'ulrmwgtsdtejirqmayzz';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const password = Deno.env.get('BACKUP_DB_PASSWORD_V4');
  const SR_URL = Deno.env.get('SUPABASE_URL')!;
  const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!password) return new Response(JSON.stringify({ error: 'pw missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Conecta backup (direct)
  const sql = postgres({
    host: `db.${REF}.supabase.co`, port: 5432, user: 'postgres', password,
    database: 'postgres', ssl: 'require', max: 1, idle_timeout: 5, connect_timeout: 10,
  });

  const prod = createClient(SR_URL, SR_KEY);

  try {
    // 1. Todos candidatos do backup
    const backupCands: any[] = await sql`
      SELECT id, full_name, cpf, email, phone, status, created_at
      FROM candidates
      WHERE cpf IS NOT NULL AND cpf != ''
      ORDER BY created_at DESC`;

    const cpfs = backupCands.map(c => String(c.cpf).replace(/\D/g, '')).filter(Boolean);

    // 2. Produção: buscar quais desses CPFs ainda existem
    const existingSet = new Set<string>();
    for (let i = 0; i < cpfs.length; i += 500) {
      const chunk = cpfs.slice(i, i + 500);
      const { data, error } = await prod.from('candidates').select('cpf').in('cpf', chunk);
      if (error) throw error;
      data?.forEach(r => existingSet.add(String(r.cpf).replace(/\D/g, '')));
    }

    // 3. Candidatos sumidos
    const missing = backupCands.filter(c => !existingSet.has(String(c.cpf).replace(/\D/g, '')));
    const missingIds = missing.map(c => c.id);

    // 4. Applications desses candidatos (pra entender o que perdeu)
    const missingApps: any[] = missingIds.length ? await sql`
      SELECT a.id, a.candidate_id, a.unit_job_id, a.status, a.created_at, a.updated_at,
             c.full_name, c.cpf,
             j.title as job_title, u.name as unit_name
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      LEFT JOIN unit_jobs uj ON uj.id = a.unit_job_id
      LEFT JOIN jobs j ON j.id = uj.job_id
      LEFT JOIN units u ON u.id = uj.unit_id
      WHERE a.candidate_id = ANY(${missingIds})
      ORDER BY a.created_at DESC` : [];

    // Resumos
    const byStatus: Record<string, number> = {};
    missing.forEach(c => { byStatus[c.status || 'null'] = (byStatus[c.status || 'null'] || 0) + 1; });

    const appByStatus: Record<string, number> = {};
    const appByJobUnit: Record<string, number> = {};
    missingApps.forEach(a => {
      appByStatus[a.status || 'null'] = (appByStatus[a.status || 'null'] || 0) + 1;
      const key = `${a.job_title || '?'} @ ${a.unit_name || '?'}`;
      appByJobUnit[key] = (appByJobUnit[key] || 0) + 1;
    });

    await sql.end();
    return new Response(JSON.stringify({
      backup_total_candidates: backupCands.length,
      production_matched: existingSet.size,
      missing_candidates_count: missing.length,
      missing_applications_count: missingApps.length,
      summary: {
        missing_candidates_by_status: byStatus,
        missing_applications_by_status: appByStatus,
        missing_applications_by_job_unit: appByJobUnit,
      },
      missing_candidates: missing,
      missing_applications: missingApps,
    }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    try { await sql.end(); } catch {}
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
