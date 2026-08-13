import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type CoalescerOptions = {
  qc: QueryClient;
  debounceMs?: number;
  maxPerWindow?: number;
  windowMs?: number;
  hardCapMs?: number;
  label?: string;
};

type Entry = { key: QueryKey; immediate: boolean };

/**
 * Agrupa invalidações de React Query num debounce trailing e aplica throttle
 * por chave de cache (sliding window). Evita refetchs duplicados durante
 * reconexões Realtime, rajadas de eventos ou foco/blur agressivo.
 */
export function createCoalescer(opts: CoalescerOptions) {
  const {
    qc,
    debounceMs = 250,
    maxPerWindow = 6,
    windowMs = 10_000,
    hardCapMs = 5_000,
    label = "coalescer",
  } = opts;

  const queue = new Map<string, Entry>();
  const history = new Map<string, number[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const serialize = (key: QueryKey) => JSON.stringify(key);

  const recentCount = (k: string, now: number) => {
    const arr = history.get(k) || [];
    const fresh = arr.filter((t) => now - t < windowMs);
    if (fresh.length !== arr.length) history.set(k, fresh);
    return fresh.length;
  };

  const recordHit = (k: string, now: number) => {
    const arr = history.get(k) || [];
    arr.push(now);
    history.set(k, arr);
  };

  const flush = () => {
    timer = null;
    if (disposed || queue.size === 0) return;
    const now = Date.now();
    let nextDelay = 0;

    for (const [k, entry] of Array.from(queue.entries())) {
      const count = recentCount(k, now);
      if (!entry.immediate && count >= maxPerWindow) {
        // Mantém na fila e calcula quando a janela libera
        const arr = history.get(k) || [];
        const oldest = arr[0] ?? now;
        const wait = Math.min(hardCapMs, Math.max(50, windowMs - (now - oldest)));
        nextDelay = Math.max(nextDelay, wait);
        if (import.meta.env?.DEV) {
          // eslint-disable-next-line no-console
          console.debug(`[${label}] rate-limited`, k, `${count}/${maxPerWindow} em ${windowMs}ms`);
        }
        continue;
      }
      queue.delete(k);
      recordHit(k, now);
      try {
        qc.invalidateQueries({ queryKey: entry.key });
      } catch {}
    }

    if (queue.size > 0) {
      timer = setTimeout(flush, nextDelay || hardCapMs);
    }
  };

  const schedule = (key: QueryKey, options?: { immediate?: boolean }) => {
    if (disposed) return;
    const k = serialize(key);
    const prev = queue.get(k);
    queue.set(k, { key, immediate: !!(options?.immediate || prev?.immediate) });
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, options?.immediate ? 0 : debounceMs);
  };

  const flushNow = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
  };

  const dispose = () => {
    disposed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    queue.clear();
    history.clear();
  };

  return { schedule, flushNow, dispose };
}

export type Coalescer = ReturnType<typeof createCoalescer>;
