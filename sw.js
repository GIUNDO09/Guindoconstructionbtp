const CACHE_NAME = 'gcbtp-v1.0.0';
const urlsToCache = [
    '/Guindo-construction/',
    '/Guindo-construction/index.html',
    '/Guindo-construction/contact.html',
    '/Guindo-construction/styles.css',
    '/Guindo-construction/script.js',
    '/Guindo-construction/Images/LOGO.jpg',
    '/Guindo-construction/Images/acceuil.png',
    '/Guindo-construction/Images/bureau gcbtp.png',
    '/Guindo-construction/Images/gcbtp1.png',
    '/Guindo-construction/Images/Hotel1.png',
    '/Guindo-construction/Images/Hotel2.png',
    '/Guindo-construction/Images/Hotel3.png',
    '/Guindo-construction/Images/Hotel4.png',
    '/Guindo-construction/Images/Hotel5.png',
    '/Guindo-construction/Images/Hotel6.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Installation du Service Worker
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('Cache ouvert');
                return cache.addAll(urlsToCache);
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
        icon: '/Guindo-construction/Images/LOGO.jpg',
        badge: '/Guindo-construction/Images/LOGO.jpg',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Voir le site',
                icon: '/Guindo-construction/Images/LOGO.jpg'
            },
            {
                action: 'close',
                title: 'Fermer',
                icon: '/Guindo-construction/Images/LOGO.jpg'
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
            clients.openWindow('/Guindo-construction/')
        );
    }
});
