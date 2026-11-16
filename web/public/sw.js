/* NiceNotes — service worker
 *
 * 只解决一件事：断网时还能打开。
 *
 * 策略按「内容会不会变」分三档：
 *   页面（navigation）  先走网络，失败再读缓存 —— 在线时总能拿到新版本
 *   /assets/ 下的文件    文件名带 hash，内容永远不变，缓存优先
 *   /api/              一律不碰，同步必须走真网络
 *
 * 改完界面如果想让所有人立刻拿到新版，把 CACHE 的版本号加一就行。
 * 不改也不会出错：页面走网络优先，旧缓存只是占点空间。
 */

const CACHE = 'nicenotes-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-512-maskable.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 逐个装，任何一个失败都不该让整个 SW 装不上
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 逐个装：某个资源拿不到不该让整批失败
      await Promise.all(
        event.data.urls.map((url) => (cache.add(url).catch(() => undefined))),
      );
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        } catch {
          const cached =
            (await caches.match(request)) ??
            (await caches.match('./index.html')) ??
            (await caches.match('./'));
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
      }
      return response;
    })(),
  );
});
