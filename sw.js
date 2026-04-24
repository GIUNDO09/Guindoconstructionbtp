const CACHE_NAME = 'gcbtp-v1.0.1';
const urlsToCache = [
    './',
    './index.html',
    './contact.html',
    './styles.css',
    './script.js',
    './Images/LOGO.jpg',
    './Images/acceuil.png',
    './Images/bureau gcbtp.png',
    './Images/gcbtp1.png',
    './Images/Hotel1.png',
    './Images/Hotel2.png',
    './Images/Hotel3.png',
    './Images/Hotel4.png',
    './Images/Hotel5.png',
    './Images/Hotel6.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    './vendor/fontawesome/css/all.min.css',
    './vendor/fontawesome/webfonts/fa-solid-900.woff2',
    './vendor/fontawesome/webfonts/fa-regular-400.woff2',
    './vendor/fontawesome/webfonts/fa-brands-400.woff2',
    './vendor/fontawesome/webfonts/fa-v4compatibility.woff2'
];

// Installation du Service Worker
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('Cache ouvert');
                // Utiliser addAll avec gestion d'erreur pour chaque URL
                return Promise.allSettled(
                    urlsToCache.map(function(url) {
                        return cache.add(url).catch(function(err) {
                            console.warn('Impossible de mettre en cache:', url, err);
                            return null;
                        });
                    })
                );
            })
            .then(function() {
                // Forcer l'activation immédiate du nouveau service worker
                return self.skipWaiting();
            })
    );
});

// Activation du Service Worker
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Suppression de l\'ancien cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Interception des requêtes
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request)
            .then(function(response) {
                // Cache hit - retourner la réponse
                if (response) {
                    return response;
                }

                return fetch(event.request).then(
                    function(response) {
                        // Vérifier si nous avons reçu une réponse valide
                        if(!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Cloner la réponse
                        var responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then(function(cache) {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    }
                );
            })
    );
});

// Gestion des notifications push
self.addEventListener('push', function(event) {
    const options = {
        body: event.data ? event.data.text() : 'Nouvelle notification de GCBTP',
        icon: './Images/LOGO.jpg',
        badge: './Images/LOGO.jpg',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Voir le site',
                icon: './Images/LOGO.jpg'
            },
            {
                action: 'close',
                title: 'Fermer',
                icon: './Images/LOGO.jpg'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('GCBTP', options)
    );
});

// Gestion des clics sur les notifications
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('./')
        );
    }
});
