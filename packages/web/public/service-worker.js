const CACHE_PREFIX = 'hermes-mobile-';
const CACHE_VERSION = 'hermes-mobile-v65';
const SHELL_CACHE = `${CACHE_VERSION}:shell`;
const RUNTIME_ASSET_CACHE = 'hermes-mobile-runtime-assets';
const RUNTIME_ASSET_CACHE_MAX_ENTRIES = 60;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(APP_SHELL.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_ASSET_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => removeEntryShellAssetsFromRuntimeCache())
      .then(() => self.clients.claim()),
  );
});

function isHermesDataApi(url) {
  return url.pathname.startsWith('/api/') && !url.pathname.includes('/api/plugins/hermes-pwa/app/');
}

function isRuntimeAsset(url) {
  return url.pathname.includes('/api/plugins/hermes-pwa/app/assets/') || url.pathname.includes('/assets/');
}

function isEntryShellAsset(url) {
  return isRuntimeAsset(url) && /\/assets\/index-[^/]+\.(?:js|css)$/u.test(url.pathname);
}

function isStaticShellAsset(url) {
  return isRuntimeAsset(url) ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest');
}

function staticAssetCacheName(url) {
  if (isEntryShellAsset(url)) return SHELL_CACHE;
  return isRuntimeAsset(url) ? RUNTIME_ASSET_CACHE : SHELL_CACHE;
}

async function removeEntryShellAssetsFromRuntimeCache() {
  const cache = await caches.open(RUNTIME_ASSET_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.filter((request) => isEntryShellAsset(new URL(request.url))).map((request) => cache.delete(request)));
}

async function trimRuntimeAssetCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - RUNTIME_ASSET_CACHE_MAX_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((request) => cache.delete(request)));
}

function safeNotificationPayload(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      data = { body: event.data ? event.data.text() : '' };
    } catch {
      data = {};
    }
  }
  const title = typeof data.title === 'string' && data.title.trim() ? data.title : 'Hermes Mobile';
  const body = typeof data.body === 'string' && data.body.trim() ? data.body : 'Hermes has an update.';
  const tag = typeof data.tag === 'string' && data.tag.trim() ? data.tag : 'hermes-mobile';
  const url = typeof data.url === 'string' && data.url.startsWith('./') ? data.url : './index.html';
  return {
    title: title.slice(0, 80),
    options: {
      body: body.slice(0, 180),
      tag,
      data: { url },
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      requireInteraction: data.type === 'approval.request',
    },
  };
}

self.addEventListener('push', (event) => {
  const payload = safeNotificationPayload(event);
  event.waitUntil(self.registration.showNotification(payload.title, payload.options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const scope = self.registration.scope;
      for (const client of clientList) {
        if (client.url && client.url.startsWith(scope)) {
          if ('focus' in client) {
            client.focus();
          }
          if ('navigate' in client) {
            return client.navigate(target);
          }
          return undefined;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
      return undefined;
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isHermesDataApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./offline.html'))),
    );
    return;
  }

  if (isStaticShellAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          const cacheName = staticAssetCacheName(url);
          caches.open(cacheName).then((cache) => cache
            .put(request, copy)
            .then(() => {
              if (cacheName === RUNTIME_ASSET_CACHE) return trimRuntimeAssetCache(cache);
              return undefined;
            }));
          return response;
        });
      }),
    );
  }
});
