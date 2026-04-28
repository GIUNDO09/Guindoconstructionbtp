// =========================================================
// GCBTP — Service Worker pour PWA
// Stratégie : network-first pour HTML (toujours frais),
// cache-first pour les autres ressources statiques
// =========================================================
const CACHE = 'gcbtp-equipe-v16';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Ne pas mettre en cache les requêtes vers Supabase ou le tunnel PC
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('trycloudflare.com')
      || url.hostname.includes('jsdelivr')) {
    return;
  }

  // Pour les pages HTML : network-first
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Sinon : cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(r => {
        if (r.ok && r.status === 200) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return r;
      });
    })
  );
});

// =========================================================
// Web Push — réception et affichage des notifications
// =========================================================
self.addEventListener('push', (event) => {
  let payload = { title: 'GCBTP', body: 'Nouvelle notification', url: '/equipe/chat.html' };
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; }
    catch { payload.body = event.data.text(); }
  }
  const opts = {
    body: payload.body,
    icon: '/Images/LOGO-1.png',
    badge: '/Images/LOGO-1.png',
    tag: payload.tag || 'gcbtp-push',
    renotify: true,
    data: { url: payload.url || '/equipe/chat.html' },
    vibrate: [100, 50, 100]
  };
  event.waitUntil(self.registration.showNotification(payload.title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/equipe/chat.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Si un onglet GCBTP est déjà ouvert, le focus
      for (const c of clients) {
        if (c.url.includes('/equipe/') && 'focus' in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
