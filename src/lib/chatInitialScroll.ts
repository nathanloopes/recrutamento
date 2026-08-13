/**
 * Scroll inicial robusto para conversas (estilo WhatsApp/Telegram).
 * Mantém o container colado no final enquanto o layout ainda está se acomodando
 * (fontes, imagens, mensagens chegando em duas etapas, etc.).
 *
 * Uso:
 *   const stop = stickToBottomUntilStable(containerEl);
 *   // chame stop() ao desmontar / trocar de thread
 */
export function stickToBottomUntilStable(
  el: HTMLElement | null,
  opts: { maxDurationMs?: number; stableMs?: number } = {}
): () => void {
  if (!el) return () => {};
  const maxDuration = opts.maxDurationMs ?? 3000;
  const stableMs = opts.stableMs ?? 400;

  let cancelled = false;
  let lastHeight = -1;
  let lastChangeAt = performance.now();
  const startedAt = performance.now();

  const snap = () => {
    if (cancelled || !el.isConnected) return;
    el.scrollTop = el.scrollHeight;
  };

  // Snap imediato + repete em rAF até a altura ficar estável por `stableMs`
  // ou até bater `maxDuration`.
  const tick = () => {
    if (cancelled) return;
    const now = performance.now();
    const h = el.scrollHeight;
    if (h !== lastHeight) {
      lastHeight = h;
      lastChangeAt = now;
      snap();
    } else {
      // mesmo sem mudança, força scroll caso algo tenha movido (auto-grow input, header).
      snap();
    }
    const stable = now - lastChangeAt >= stableMs;
    const expired = now - startedAt >= maxDuration;
    if (stable || expired) {
      cleanup();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  let rafId = requestAnimationFrame(tick);

  // MutationObserver: qualquer alteração no conteúdo durante a janela
  // reposiciona no final imediatamente (sem esperar o próximo rAF).
  const mo = new MutationObserver(() => {
    if (cancelled) return;
    snap();
    lastChangeAt = performance.now();
  });
  mo.observe(el, { childList: true, subtree: true, characterData: true });

  // Imagens que carregam depois também aumentam a altura
  const onImgLoad = () => snap();
  el.addEventListener("load", onImgLoad, true);

  function cleanup() {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(rafId);
    mo.disconnect();
    el.removeEventListener("load", onImgLoad, true);
  }

  return cleanup;
}
