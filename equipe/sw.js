// =========================================================
// GCBTP — Service Worker pour PWA
// Stratégie : network-first pour HTML (toujours frais),
// cache-first pour les autres ressources statiques
// =========================================================
const CACHE = 'gcbtp-equipe-v1';

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
