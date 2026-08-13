export function getSafariTabsConfig(): "compacta" | "inferior" | "superior" | "desconhecido" {
  if (!window.visualViewport) return "desconhecido";

  const vv = window.visualViewport;
  const viewportHeight = vv.height;
  const viewportOffsetTop = vv.offsetTop;
  const totalHeight = window.innerHeight;
  const bottomSpace = totalHeight - (viewportHeight + viewportOffsetTop);

  if (viewportOffsetTop > 60) return "superior";
  if (bottomSpace > 60) return "inferior";
  return "compacta";
}

export const detectSafariBarPosition = getSafariTabsConfig;
