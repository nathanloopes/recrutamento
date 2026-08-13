// DEV only: encaminha apenas os logs do detector para o terminal do Vite via /__log.
// Filtra para enviar SOMENTE as 4 linhas permitidas.
if (import.meta.env.DEV) {
  const originalLog = console.log;
  const ALLOWED = [
    "sistema operacional:",
    "versao do sistema operacional:",
    "browser utilizado:",
    "config abas:",
  ];

  console.log = (...args: any[]) => {
    originalLog(...args);

    try {
      const message = args
        .map((a) => {
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" ");

      if (!ALLOWED.some((p) => message.startsWith(p))) return;

      fetch("/__log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      }).catch(() => {});
    } catch {
      /* noop */
    }
  };
}

// Ignora erros disparados por extensões do Chrome (ex.: content_reporter.js
// "Cannot use import statement outside a module") — não pertencem ao app.
if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (ev) => {
      const src = (ev.filename || "") + " " + (ev.error?.stack || "");
      if (src.includes("chrome-extension://") || src.includes("moz-extension://")) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
      }
    },
    true
  );
  window.addEventListener("unhandledrejection", (ev) => {
    const stack = String((ev.reason as any)?.stack || "");
    if (stack.includes("chrome-extension://") || stack.includes("moz-extension://")) {
      ev.preventDefault();
    }
  });
}
