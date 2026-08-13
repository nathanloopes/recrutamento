import { useEffect } from "react";

/**
 * Adiciona/remove a classe `keyboard-open` no <body> quando o teclado virtual
 * abre/fecha em PWA iOS/Android. Usa visualViewport para detectar a redução
 * da altura visível.
 */
export function useKeyboardOpenClass() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const THRESHOLD = 150; // px de diferença para considerar teclado aberto

    const update = () => {
      const diff = window.innerHeight - vv.height;
      const open = diff > THRESHOLD;
      document.body.classList.toggle("keyboard-open", open);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.body.classList.remove("keyboard-open");
    };
  }, []);
}
