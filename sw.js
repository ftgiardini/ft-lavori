// Service worker: l'app funziona anche senza connessione (in cantiere).
// Quando si modificano i file, aumentare la versione per aggiornare la cache sui telefoni.
const VERSION = 'ftg-lavori-v20';

const SHELL = [
  './vendor/jspdf.umd.min.js',
  './js/quote-pdf.js',
  './js/views/quotes.js',
  './js/views/event-sheet.js',
  './img/preventivo-logo.png',
  './img/preventivo-mail.png',
  './img/preventivo-tel.png',
  './vendor/supabase.js',
  './js/config.js',
  './js/cloud.js',
  './js/views/team.js',
  './js/views/payments.js',
  './css/responsive.css',
  './css/mobile-app.css',
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/views.css',
  './js/app.js',
  './js/store.js',
  './js/data.js',
  './js/utils.js',
  './js/icons.js',
  './js/ui.js',
  './js/components.js',
  './js/scheduler.js',
  './js/contract-parser.js',
  './js/views/home.js',
  './js/views/today.js',
  './js/views/calendar.js',
  './js/views/condos.js',
  './js/views/condo-form.js',
  './js/views/job-sheet.js',
  './js/views/more.js',
  './img/logo.svg',
  './img/logo-mark.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // File dell'app: rete prima (così gli aggiornamenti arrivano subito), cache se offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      // no-cache: chiede sempre al server se il file è cambiato (evita versioni vecchie)
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Font Google e librerie CDN: cache prima
  if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy));
        return res;
      }))
    );
  }
});
