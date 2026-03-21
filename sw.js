// Service Worker — ASD Basket Campodarsego
// Versione: 20260321_1057
// Si aggiorna automaticamente ad ogni nuova build

var CACHE_NAME = 'basket052441-20260321_1244';
var CACHE_URLS = [
  './basket052441.html',
  './basket-core.js',
];

// Install: precacha i file
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_URLS);
    }).then(function() {
      return self.skipWaiting(); // attiva subito senza aspettare tab chiuse
    })
  );
});

// Activate: elimina cache vecchie
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim(); // prende controllo di tutti i tab aperti
    })
  );
});

// Fetch: network-first per HTML, cache-first per altri
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Per i file HTML: sempre dalla rete (aggiornamento immediato)
  if(url.endsWith('.html') || url.indexOf('basket052441') > -1) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        return response;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
  } else {
    // Per JS/CSS: cache-first con fallback rete
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request);
      })
    );
  }
});
