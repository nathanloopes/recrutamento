import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import postgres from 'npm:postgres@3.4.4';

const BACKUPS = [
  { name: 'v3', ref: 'fxbbjjuklxfsxdzpmuue', passwordEnv: 'BACKUP_DB_PASSWORD_V3' },
  { name: 'v4', ref: 'ulrmwgtsdtejirqmayzz', passwordEnv: 'BACKUP_DB_PASSWORD_V4' },
];

function hosts(ref: string) {
  return [
    { name: 'direct', host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres' },
    { name: 'pooler-sa', host: 'aws-0-sa-east-1.pooler.supabase.com', port: 6543, user: `postgres.${ref}` },
    { name: 'pooler-us-east', host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543, user: `postgres.${ref}` },
    { name: 'pooler-us-west', host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543, user: `postgres.${ref}` },
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
  throw new Error(JSON.stringify({ tried: errs }));
}

const TOKENS = ['375f6', 'a959f'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const result: any = {};
  for (const b of BACKUPS) {
    const pwd = Deno.env.get(b.passwordEnv);
    if (!pwd) { result[b.name] = { error: `missing ${b.passwordEnv}` }; continue; }
    let sql: any;
    try {
      const c = await connect(b.ref, pwd); sql = c.sql;
    } catch (e: any) {
      result[b.name] = { error: 'connect failed', detail: e.message };
      continue;
    }
    try {
      // search by token suffix OR by slug
      const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='recruitment_links' ORDER BY ordinal_position`;
      const links = await sql`
        SELECT rl.*, u.name as unit_name
        FROM recruitment_links rl
        LEFT JOIN units u ON u.id = rl.unit_id
        WHERE rl.token ILIKE ANY (${['%375f6%', '%a959f%']})
           OR (u.name ILIKE '%santo antonio%' OR u.name ILIKE '%lapa%')
        ORDER BY rl.created_at DESC
        LIMIT 50
      `;
      result[b.name] = { columns: cols.map((c:any)=>c.column_name), count: links.length, links };
    } catch (e: any) {
      result[b.name] = { error: 'query failed', detail: e.message };
    } finally {
      try { await sql.end({ timeout: 1 }); } catch {}
    }
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
