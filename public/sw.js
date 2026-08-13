self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Nova notificação', body: event.data.text() };
  }

  const title = data.title || 'Nova notificação';
  const tag = data.notification_id || data.tag || undefined;
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192-maskable.png',
    badge: '/icons/icon-192-maskable.png',
    tag,
    renotify: !!tag,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
      notification_id: data.notification_id || null,
      no_action: data.no_action === true,
    },
  };

  event.waitUntil((async () => {
    // Avisa todas as abas abertas para invalidar caches (badge/lista)
    try {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        c.postMessage({ type: 'PUSH_RECEIVED', notification_id: data.notification_id });
      }
    } catch {
      // ignora
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification.data || {};
  if (payload && payload.no_action === true) {
    return;
  }
  const url = (typeof payload === 'string' ? payload : payload.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url, notification_id: payload.notification_id });
            return client.focus().then((c) => {
              if ('navigate' in c) {
                try { c.navigate(url); } catch { /* ignora cross-origin */ }
              }
              return c;
            });
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});
