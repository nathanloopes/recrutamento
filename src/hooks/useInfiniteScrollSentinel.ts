import { useEffect, useRef } from "react";

/**
 * Observa um elemento sentinela e chama `onLoadMore` quando ele entra na viewport.
 * Ideal para paginação por scroll infinito.
 *
 * Uso:
 *   const sentinelRef = useInfiniteScrollSentinel(() => setCount(c => c + 20), hasMore);
 *   {hasMore && <div ref={sentinelRef} />}
 */
export function useInfiniteScrollSentinel<T extends HTMLElement = HTMLDivElement>(
  onLoadMore: () => void,
  enabled: boolean = true,
  options: IntersectionObserverInit = { rootMargin: "200px 0px" }
) {
  const ref = useRef<T | null>(null);
  const loadingRef = useRef(false);
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !loadingRef.current) {
          loadingRef.current = true;
          try {
            cbRef.current();
          } finally {
            // Libera o próximo disparo depois que o browser reflow (evita loops
            // quando o novo conteúdo mantém a sentinela visível por 1 tick).
            setTimeout(() => {
              loadingRef.current = false;
            }, 150);
          }
        }
      },
      options
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, options.rootMargin, options.threshold, options.root]);

  return ref;
}
