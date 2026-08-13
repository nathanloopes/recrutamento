// One-off: extracts deleted SOCIAL MEDIA / Giovanna data from backup project
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import postgres from 'npm:postgres@3.4.4';

const BACKUP_HOST = 'aws-0-sa-east-1.pooler.supabase.com'; // common pooler; we'll fall back
const BACKUP_PROJECT_REF = 'aivdqtjliopnfazvbewx';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const password = Deno.env.get('BACKUP_DB_PASSWORD');
  if (!password) {
    return new Response(JSON.stringify({ error: 'BACKUP_DB_PASSWORD missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Try multiple hosts (direct + poolers across regions)
  const hosts = [
    { host: `db.${BACKUP_PROJECT_REF}.supabase.co`, port: 5432, user: 'postgres', label: 'direct' },
    { host: 'aws-0-sa-east-1.pooler.supabase.com', port: 6543, user: `postgres.${BACKUP_PROJECT_REF}`, label: 'pooler-sa-east-1' },
    { host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543, user: `postgres.${BACKUP_PROJECT_REF}`, label: 'pooler-us-east-1' },
    { host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543, user: `postgres.${BACKUP_PROJECT_REF}`, label: 'pooler-us-west-1' },
  ];

  let sql: any = null;
  let usedHost = '';
  const errors: any[] = [];
  for (const h of hosts) {
    try {
      const s = postgres({
        host: h.host, port: h.port, user: h.user, password, database: 'postgres',
        ssl: 'require', max: 1, idle_timeout: 5, connect_timeout: 10,
      });
      await s`select 1`;
      sql = s; usedHost = h.label; break;
    } catch (e: any) {
      errors.push({ host: h.label, error: e.message });
    }
  }
  if (!sql) {
    return new Response(JSON.stringify({ error: 'all hosts failed', tried: errors }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const UNIT_JOB_ID = 'ea6421d6-9d2c-4450-a1d2-f33461940b52';
  const GIOVANNA_CPF = '40371243866';
  const GIOVANNA_EMAIL = 'giovannagiammarino18@gmail.com';

  try {
    const unitJob = await sql`SELECT * FROM unit_jobs WHERE id = ${UNIT_JOB_ID}`;
    const candidateOld = await sql`SELECT * FROM candidates WHERE cpf = ${GIOVANNA_CPF} OR email = ${GIOVANNA_EMAIL}`;
    const candidateIds = candidateOld.map((c: any) => c.id);

    const applications = candidateIds.length
      ? await sql`SELECT * FROM applications WHERE candidate_id = ANY(${candidateIds}) OR unit_job_id = ${UNIT_JOB_ID}`
      : await sql`SELECT * FROM applications WHERE unit_job_id = ${UNIT_JOB_ID}`;
    const appIds = applications.map((a: any) => a.id);

    const interviews = appIds.length
      ? await sql`SELECT * FROM interviews WHERE application_id = ANY(${appIds})`
      : [];
    const testAssignments = appIds.length
      ? await sql`SELECT * FROM test_assignments WHERE application_id = ANY(${appIds})`
      : [];
    const stepResponses = appIds.length
      ? await sql`SELECT * FROM step_responses WHERE application_id = ANY(${appIds})`
      : [];
    const cycles = appIds.length
      ? await sql`SELECT * FROM application_cycles WHERE application_id = ANY(${appIds})`
      : [];
    const journey = appIds.length
      ? await sql`SELECT * FROM application_journey_events WHERE application_id = ANY(${appIds}) ORDER BY created_at`
      : [];
    const safe = async (label: string, fn: () => Promise<any>) => {
      try { return await fn(); } catch (e: any) { return { __error: e.message, label }; }
    };
    const recruitmentLinks = await safe('recruitment_links', () =>
      sql`SELECT * FROM recruitment_links WHERE unit_job_id = ${UNIT_JOB_ID}`);
    const documentRequests = appIds.length
      ? await safe('document_requests', () => sql`SELECT * FROM document_requests WHERE application_id = ANY(${appIds})`)
      : [];
    const interviewFeedback = appIds.length
      ? await safe('interview_feedback', () => sql`SELECT * FROM interview_feedback WHERE application_id = ANY(${appIds})`)
      : [];

    await sql.end();

    return new Response(JSON.stringify({
      usedHost,
      counts: {
        unit_jobs: unitJob.length,
        candidates_old: candidateOld.length,
        applications: applications.length,
        interviews: interviews.length,
        test_assignments: testAssignments.length,
        step_responses: stepResponses.length,
        application_cycles: cycles.length,
        application_journey_events: journey.length,
        recruitment_links: recruitmentLinks.length,
        document_requests: documentRequests.length,
        interview_feedback: interviewFeedback.length,
      },
      data: {
        unit_jobs: unitJob,
        candidates_old: candidateOld,
        applications,
        interviews,
        test_assignments: testAssignments,
        step_responses: stepResponses,
        application_cycles: cycles,
        application_journey_events: journey,
        recruitment_links: recruitmentLinks,
        document_requests: documentRequests,
        interview_feedback: interviewFeedback,
      },
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    try { await sql.end(); } catch {}
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
