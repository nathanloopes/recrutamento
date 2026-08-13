/**
 * Banner local em foreground.
 *
 * O Service Worker só dispara `showNotification` no evento `push`, que no
 * Android/iOS o SO **não** mostra como banner quando o app está aberto.
 * Este helper força a exibição via `registration.showNotification`,
 * garantindo banner do SO mesmo com o app em primeiro plano. Quando não
 * houver permissão / SW disponíveis, faz fallback para um toast in-app.
 */
import { toast } from "sonner";

export interface LocalBannerOptions {
  title: string;
  body: string;
  url?: string | null;
  tag?: string | null;
}

export async function showLocalBanner(opts: LocalBannerOptions): Promise<void> {
  const { title, body, url, tag } = opts;

  const safeTitle = title?.trim() || "Nova notificação";
  const safeBody = body?.trim() || "";

  // 1) Banner do SO via Service Worker (cobre Android/iOS PWA com permissão concedida)
  try {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      const reg = await navigator.serviceWorker.ready;
      // Cast para any: `renotify` e `vibrate` existem em Android/Chrome mas
      // não estão tipadas em lib.dom.
      await reg.showNotification(safeTitle, {
        body: safeBody,
        icon: "/icons/icon-192-maskable.png",
        badge: "/icons/icon-192-maskable.png",
        tag: tag || undefined,
        renotify: !!tag,
        requireInteraction: true,
        vibrate: [200, 100, 200],
        data: { url: url || "/notificacoes", tag, fromForeground: true },
      } as any);
      return;
    }
  } catch (err) {
    console.warn("[foregroundNotifications] showNotification falhou:", err);
  }

  // 2) Fallback in-app: toast
  toast(safeTitle, {
    description: safeBody,
    action: url
      ? {
          label: "Abrir",
          onClick: () => {
            if (typeof window !== "undefined") window.location.assign(url);
          },
        }
      : undefined,
  });
}
