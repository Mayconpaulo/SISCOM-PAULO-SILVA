// Helper imported by the SISCOM PWA service worker for instant mandatory updates and cache purging
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data.type === 'SISCOM_CLEAR_ALL_CACHES') {
    const replyPort = event.ports && event.ports[0];
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined)
        .finally(() => {
          if (replyPort) {
            try {
              replyPort.postMessage({ ok: true });
            } catch {
              // ignore closed port
            }
          }
        })
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('workbox-precache') ||
                key.startsWith('siscom-ephemeral-')
            )
            .map((key) => caches.delete(key))
        );
      } catch {
        // ignore cache cleanup failures
      }

      try {
        await self.clients.claim();
        const allClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          client.postMessage({ type: 'SISCOM_SW_ACTIVATED' });
        }
      } catch {
        // ignore client notify failures
      }
    })()
  );
});
