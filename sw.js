// Permite instalar Control de baños como app y que abra rápido.
// Los datos siempre se piden a Supabase en el momento; aquí solo se guarda la «carcasa» de la web.
// Si cambias la lista de archivos, sube también el número de VERSION.
const VERSION = 'v1';
const CACHE = `control-wc-${VERSION}`;
const CARCASA = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.json', 'logo.svg',
  'favicon-32.png', 'favicon-48.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CARCASA.map(u => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('control-wc-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Red primero (así los cambios publicados se ven enseguida); sin conexión, lo guardado.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
