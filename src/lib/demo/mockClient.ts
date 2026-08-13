// Cliente Supabase FICTÍCIO para o modo demonstração (portfólio).
// Emula o suficiente da API do supabase-js para o app rodar sem backend:
//  - .from(tabela) com query builder encadeável e "thenable"
//  - .auth (sessão demo em memória/localStorage)
//  - .rpc, .functions, .channel, .storage (stubs benignos)
//
// Filosofia: NUNCA lançar. Métodos desconhecidos viram no-op encadeável,
// garantindo que nenhuma tela quebre durante uma apresentação.

import { demoTables, DEMO_CANDIDATE_ID, DEMO_ADMIN_ID } from "./data";
import { getDemoRole, setDemoRole, type DemoRole } from "./config";

type QueryResult = { data: any; error: any; count: number | null; status: number; statusText: string };

const ADMIN_ROLES = new Set(["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento", "auditor_admin"]);

function getPath(obj: any, path: string): any {
  if (!path.includes(".")) return obj?.[path];
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function compare(rowVal: any, op: string, value: any): boolean {
  switch (op) {
    case "eq": return rowVal === value || String(rowVal) === String(value);
    case "neq": return !(rowVal === value || String(rowVal) === String(value));
    case "gt": return rowVal > value;
    case "gte": return rowVal >= value;
    case "lt": return rowVal < value;
    case "lte": return rowVal <= value;
    case "in": return Array.isArray(value) && value.map(String).includes(String(rowVal));
    case "like":
    case "ilike": {
      const pat = String(value).replace(/%/g, "").toLowerCase();
      return String(rowVal ?? "").toLowerCase().includes(pat);
    }
    case "is":
      if (value === null) return rowVal === null || rowVal === undefined;
      return rowVal === value;
    default: return true;
  }
}

interface Filter { column: string; op: string; value: any; negate?: boolean }

class DemoQueryBuilder {
  private table: string;
  private filters: Filter[] = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private rangeSpec: { from: number; to: number } | null = null;
  private limitSpec: number | null = null;
  private countMode = false;
  private headMode = false;
  private op: { type: "insert" | "update" | "delete" | "upsert"; payload?: any } | null = null;

  constructor(table: string) {
    this.table = table;
  }

  private base(): any[] {
    return demoTables[this.table] ? [...demoTables[this.table]] : [];
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.headMode = true;
    return this;
  }
  insert(payload: any) { this.op = { type: "insert", payload }; return this; }
  update(payload: any) { this.op = { type: "update", payload }; return this; }
  upsert(payload: any) { this.op = { type: "upsert", payload }; return this; }
  delete() { this.op = { type: "delete" }; return this; }

  eq(column: string, value: any) { this.filters.push({ column, op: "eq", value }); return this; }
  neq(column: string, value: any) { this.filters.push({ column, op: "neq", value }); return this; }
  gt(column: string, value: any) { this.filters.push({ column, op: "gt", value }); return this; }
  gte(column: string, value: any) { this.filters.push({ column, op: "gte", value }); return this; }
  lt(column: string, value: any) { this.filters.push({ column, op: "lt", value }); return this; }
  lte(column: string, value: any) { this.filters.push({ column, op: "lte", value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ column, op: "in", value }); return this; }
  like(column: string, value: any) { this.filters.push({ column, op: "like", value }); return this; }
  ilike(column: string, value: any) { this.filters.push({ column, op: "ilike", value }); return this; }
  is(column: string, value: any) { this.filters.push({ column, op: "is", value }); return this; }
  not(column: string, op: string, value: any) { this.filters.push({ column, op, value, negate: true }); return this; }
  filter(column: string, op: string, value: any) { this.filters.push({ column, op, value }); return this; }
  match(obj: Record<string, any>) { Object.entries(obj).forEach(([c, v]) => this.filters.push({ column: c, op: "eq", value: v })); return this; }
  or() { return this; }
  contains(column: string, value: any) { this.filters.push({ column, op: "in", value }); return this; }
  order(column: string, opts?: { ascending?: boolean }) { this.orderSpec = { column, ascending: opts?.ascending !== false }; return this; }
  range(from: number, to: number) { this.rangeSpec = { from, to }; return this; }
  limit(n: number) { this.limitSpec = n; return this; }
  abortSignal() { return this; }
  returns() { return this; }

  private applyFilters(rows: any[]): any[] {
    let out = rows;
    for (const f of this.filters) {
      out = out.filter((row) => {
        const val = getPath(row, f.column);
        const res = compare(val, f.op, f.value);
        return f.negate ? !res : res;
      });
    }
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      out = [...out].sort((a, b) => {
        const av = getPath(a, column);
        const bv = getPath(b, column);
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.rangeSpec) out = out.slice(this.rangeSpec.from, this.rangeSpec.to + 1);
    if (this.limitSpec != null) out = out.slice(0, this.limitSpec);
    return out;
  }

  private runMutation(): any[] {
    const store = demoTables[this.table] || (demoTables[this.table] = []);
    if (!this.op) return [];
    if (this.op.type === "insert" || this.op.type === "upsert") {
      const items = Array.isArray(this.op.payload) ? this.op.payload : [this.op.payload];
      const inserted = items.map((it: any, i: number) => ({
        id: it.id ?? `demo-${this.table}-${Date.now()}-${i}`,
        created_at: it.created_at ?? new Date().toISOString(),
        ...it,
      }));
      store.push(...inserted);
      return inserted;
    }
    // update / delete atuam sobre linhas filtradas
    const affected = this.applyFilters(store);
    if (this.op.type === "update") {
      affected.forEach((row) => Object.assign(row, this.op!.payload));
      return affected;
    }
    if (this.op.type === "delete") {
      const affectedSet = new Set(affected);
      demoTables[this.table] = store.filter((r) => !affectedSet.has(r));
      return affected;
    }
    return [];
  }

  private resolve(): QueryResult {
    try {
      let rows: any[];
      if (this.op) rows = this.runMutation();
      else rows = this.applyFilters(this.base());
      const count = rows.length;
      if (this.headMode) return { data: null, error: null, count, status: 200, statusText: "OK" };
      return { data: rows, error: null, count, status: 200, statusText: "OK" };
    } catch (e) {
      return { data: [], error: null, count: 0, status: 200, statusText: "OK" };
    }
  }

  async single(): Promise<{ data: any; error: any }> {
    const { data } = this.resolve();
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "No rows found", details: null, hint: null } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<{ data: any; error: any }> {
    const { data } = this.resolve();
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return { data: rows[0] ?? null, error: null };
  }

  then(onFulfilled?: (v: QueryResult) => any, onRejected?: (e: any) => any) {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }
  catch(onRejected?: (e: any) => any) { return Promise.resolve(this.resolve()).catch(onRejected); }
  finally(cb?: () => void) { return Promise.resolve(this.resolve()).finally(cb); }
}

// Envolve o builder num Proxy: métodos desconhecidos viram no-op encadeável.
function makeBuilder(table: string): any {
  const target = new DemoQueryBuilder(table);
  const proxy: any = new Proxy(target, {
    get(obj: any, prop: string | symbol) {
      if (prop in obj) {
        const val = obj[prop];
        return typeof val === "function" ? val.bind(obj) : val;
      }
      if (typeof prop === "symbol") return undefined;
      // método desconhecido → retorna o próprio proxy (encadeável)
      return () => proxy;
    },
  });
  return proxy;
}

// ─── Auth demo ───────────────────────────────────────────────────────────
type Listener = (event: string, session: any) => void;
const listeners: Listener[] = [];

function base64url(input: string): string {
  const b64 = typeof btoa !== "undefined" ? btoa(input) : Buffer.from(input).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildToken(userId: string, role: DemoRole): string {
  const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: userId,
    session_id: `demo-session-${role}`,
    role: "authenticated",
    demo_role: role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  }));
  return `${header}.${payload}.demo`;
}

function buildSession(role: DemoRole) {
  const userId = role === "admin" ? DEMO_ADMIN_ID : DEMO_CANDIDATE_ID;
  const token = buildToken(userId, role);
  return {
    access_token: token,
    refresh_token: `demo-refresh-${role}`,
    expires_in: 60 * 60 * 24,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    token_type: "bearer",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: role === "admin" ? "admin@exemplo.com" : "ana.souza@exemplo.com",
      app_metadata: { provider: "demo" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

const SESSION_KEY = "demo.auth.active";

function readActiveSession(): any {
  try {
    if (window.localStorage.getItem(SESSION_KEY) !== "1") return null;
    return buildSession(getDemoRole());
  } catch {
    return null;
  }
}

function emit(event: string, session: any) {
  listeners.forEach((cb) => {
    try { cb(event, session); } catch { /* ignore */ }
  });
}

export function demoSignIn(role: DemoRole) {
  setDemoRole(role);
  try { window.localStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
  const session = buildSession(role);
  emit("SIGNED_IN", session);
  return session;
}

export function demoSignOut() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  emit("SIGNED_OUT", null);
}

const okResult = { data: null, error: null };

const demoAuth = {
  async getSession() { return { data: { session: readActiveSession() }, error: null }; },
  async getUser() { const s = readActiveSession(); return { data: { user: s?.user ?? null }, error: null }; },
  onAuthStateChange(cb: Listener) {
    listeners.push(cb);
    setTimeout(() => cb("INITIAL_SESSION", readActiveSession()), 0);
    return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
  },
  async setSession() { return { data: { session: readActiveSession() }, error: null }; },
  async refreshSession() { return { data: { session: readActiveSession() }, error: null }; },
  async signInWithPassword() { const s = demoSignIn(getDemoRole()); return { data: { session: s, user: s.user }, error: null }; },
  async signOut() { demoSignOut(); return { error: null }; },
  async updateUser() { return { data: { user: readActiveSession()?.user ?? null }, error: null }; },
  async resetPasswordForEmail() { return okResult; },
  async verifyOtp() { return { data: { session: readActiveSession(), user: readActiveSession()?.user ?? null }, error: null }; },
  async exchangeCodeForSession() { return { data: { session: readActiveSession() }, error: null }; },
  async resend() { return okResult; },
};

// ─── RPC / functions / realtime / storage ────────────────────────────────
function demoRpc(name: string, params?: any) {
  if (name === "has_role") {
    const role = getDemoRole();
    const target = params?._role;
    const value = role === "admin" ? ADMIN_ROLES.has(target) : false;
    return Promise.resolve({ data: value, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

const demoFunctions = {
  async invoke() { return { data: { ok: true }, error: null }; },
};

function demoChannel() {
  const ch: any = {
    on() { return ch; },
    subscribe(cb?: (status: string) => void) { if (cb) setTimeout(() => cb("SUBSCRIBED"), 0); return ch; },
    unsubscribe() { return Promise.resolve("ok"); },
    send() { return Promise.resolve("ok"); },
    track() { return Promise.resolve("ok"); },
    untrack() { return Promise.resolve("ok"); },
  };
  return ch;
}

const demoStorage = {
  from() {
    return {
      getPublicUrl() { return { data: { publicUrl: "" } }; },
      async upload() { return { data: { path: "" }, error: null }; },
      async remove() { return { data: [], error: null }; },
      async createSignedUrl() { return { data: { signedUrl: "" }, error: null }; },
      async download() { return { data: null, error: null }; },
      async list() { return { data: [], error: null }; },
    };
  },
};

export function createDemoClient(): any {
  return {
    from: (table: string) => makeBuilder(table),
    rpc: demoRpc,
    auth: demoAuth,
    functions: demoFunctions,
    channel: () => demoChannel(),
    removeChannel: () => Promise.resolve("ok"),
    removeAllChannels: () => Promise.resolve("ok"),
    getChannels: () => [],
    storage: demoStorage,
  };
}
