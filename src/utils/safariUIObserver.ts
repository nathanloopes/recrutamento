/* eslint-disable no-console */
import { getSafariTabsConfig } from "./detectSafariBarPosition";

export function startSafariDetection() {
  const detect = () => {
    const config = getSafariTabsConfig();
    console.log(`config abas: ${config}`);
  };

  requestAnimationFrame(() => {
    setTimeout(detect, 700);
  });

  window.visualViewport?.addEventListener("resize", detect);
  window.addEventListener("orientationchange", detect);
  window.addEventListener("focus", detect);
}

// Compat
export const detectSafariTabLayout = startSafariDetection;
export const startSafariUIObserver = startSafariDetection;
