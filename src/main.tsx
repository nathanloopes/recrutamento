import "@/utils/forwardConsole";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { registerPWA } from "./lib/registerPWA";
import { captureOriginDeeplinkFromUrl } from "./lib/originDeeplink";
import { isNativeApp } from "./lib/isNativeApp";
import { initNativeKeyboardFix } from "./lib/nativeKeyboardFix";

import "./index.css";

// Captura silenciosa do link de divulgação ANTES de qualquer login.
captureOriginDeeplinkFromUrl();

if (typeof window !== "undefined" && isNativeApp()) {
  document.documentElement.dataset.nativeApp = "true";
  initNativeKeyboardFix();
}

createRoot(document.getElementById("root")!).render(<App />);

// Registra service worker (usado apenas para push notifications).
registerPWA();
