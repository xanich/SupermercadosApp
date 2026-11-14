// Service worker minimo: guarda la "carcasa" de la app para abrirla rapido y sin conexion.
// Los datos (precios) siempre se piden a la red primero.
const CACHE = 'compra-1.2.0';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'compare.js', 'config.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const { request } = ev;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  // Red primero; si no hay conexion, lo ultimo guardado.
  ev.respondWith(
    fetch(request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copia));
        return res;
      })
      .catch(() => caches.match(request)),
  );
});
