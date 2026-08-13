import { startSafariDetection } from "./safariUIObserver";

/**
 * Detecção de dispositivo. NÃO executa em escopo global.
 * Deve ser chamado SOMENTE de dentro de useEffect (via DeviceProvider).
 */
export function logDevice() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);

  let browser = "desconhecido";
  if (/Safari/.test(ua) && !/CriOS/.test(ua) && !/FxiOS/.test(ua)) browser = "Safari";
  if (/CriOS/.test(ua)) browser = "Chrome";

  if (isIOS && browser === "Safari") {
    startSafariDetection();
  }
}
