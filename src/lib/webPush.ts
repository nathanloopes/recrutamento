/**
 * Web Push (VAPID) client — universal.
 * Funciona em Chrome/Edge/Firefox (Android+Desktop) e Safari iOS 16.4+ (PWA instalado).
 *
 * Backend: edge functions register-web-push / unregister-web-push / get-vapid-public-key.
 */
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/isNativeApp";

let cachedPublicKey: string | null = null;

export function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return false;
  // iOS Safari
  if ((window.navigator as unknown as { standalone?: boolean }).standalone) return true;
  // Demais: display-mode standalone
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function getVapidPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const { data, error } = await supabase.functions.invoke("get-vapid-public-key");
  if (error || !data?.publicKey) {
    throw new Error("Falha ao obter chave VAPID");
  }
  cachedPublicKey = data.publicKey as string;
  return cachedPublicKey;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (isNativeApp()) {
    throw new Error("Notificações push do navegador não estão disponíveis no app nativo.");
  }
  if (!isWebPushSupported()) {
    throw new Error("Notificações push não suportadas neste navegador.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permissão de notificações negada.");
  }

  // Timeout de 8s no serviceWorker.ready — em contextos sem SW registrado
  // (ex: preview Lovable em iframe) a Promise nunca resolve.
  const reg = await Promise.race<ServiceWorkerRegistration>([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) =>
      setTimeout(
        () => reject(new Error("Service Worker indisponível neste contexto. Tente no app publicado.")),
        8000,
      ),
    ),
  ]);

  // Reaproveita inscrição se já existe
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const publicKey = await getVapidPublicKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.functions.invoke("register-web-push", {
    body: {
      endpoint: sub.endpoint,
      keys: {
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      },
      user_agent: navigator.userAgent,
    },
  });
  if (error) {
    throw new Error("Falha ao registrar inscrição no servidor.");
  }

  return sub;
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    // ignora
  }
  await supabase.functions.invoke("unregister-web-push", { body: { endpoint } });
}

/**
 * Reivindica a inscrição push existente para o usuário ATUALMENTE logado.
 * Chamada após SIGNED_IN para garantir que o token do dispositivo seja
 * vinculado ao novo usuário (caso o navegador já tenha uma PushSubscription
 * persistida de outra conta).
 */
export async function reclaimPushSubscription(): Promise<void> {
  if (isNativeApp()) return;
  if (!isWebPushSupported()) return;
  try {
    let sub = await getCurrentSubscription();

    // Caso o logout anterior tenha feito sub.unsubscribe() (destruindo o endpoint
    // no navegador), o próximo login chegava aqui sem inscrição e o desktop ficava
    // sem token até o usuário re-habilitar manualmente. Se a permissão já foi
    // concedida, recriamos a inscrição silenciosamente.
    if (!sub) {
      try {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") {
          return;
        }
        sub = await subscribeToPush();
      } catch (err) {
        console.warn("[webPush] reclaim re-subscribe falhou:", err);
        return;
      }
    }

    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) return;
    await supabase.functions.invoke("register-web-push", {
      body: {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      },
    });
  } catch (err) {
    console.warn("[webPush] reclaimPushSubscription falhou:", err);
  }
}

/**
 * Logout completo do push: desativa no servidor (com o token de acesso ainda
 * válido), faz unsubscribe no navegador (gera endpoint novo no próximo login)
 * e tolera falhas. Aceita um accessToken opcional para garantir autenticação
 * mesmo em fluxos onde a sessão Supabase já foi limpa.
 */
export async function logoutPushSubscription(accessToken?: string): Promise<void> {
  if (isNativeApp()) return;
  if (!isWebPushSupported()) return;
  try {
    const sub = await getCurrentSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;

    // 1) Desativar no servidor (best-effort)
    try {
      if (accessToken) {
        await fetch(`${SUPABASE_URL}/functions/v1/unregister-web-push`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ endpoint }),
        });
      } else {
        await supabase.functions.invoke("unregister-web-push", { body: { endpoint } });
      }
    } catch (err) {
      console.warn("[webPush] unregister-web-push falhou:", err);
    }

    // 2) Unsubscribe no navegador para forçar endpoint novo no próximo login
    try {
      await sub.unsubscribe();
    } catch {
      // ignora
    }
  } catch (err) {
    console.warn("[webPush] logoutPushSubscription falhou:", err);
  }
}
