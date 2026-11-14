const RELEASE = null;
const SHELL = [];
const DATASETS = {
  'data/serie-a-2026-27.json': { mode: 'real', season: '2026/27' },
  'data/serie-a-2025-26.json': { mode: 'real', season: '2025/26' },
  'data/demo.json': { mode: 'demo', season: '2026/27' }
};

if (RELEASE) {
  const scope = self.registration.scope;
  const shellPrefix = `fantalab-shell:${scope}:`;
  const shellName = shellPrefix + RELEASE;
  const dataName = `fantalab-snapshots:${scope}:v1`;
  const index = new URL('index.html', scope).href;
  const shellUrls = new Set(SHELL.map(({ path }) => new URL(path, scope).href));

  async function refreshDataset(url, expected) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { cache: 'no-cache', redirect: 'error', signal: controller.signal });
      if (!response.ok) return null;
      const parsed = await response.clone().json();
      if (parsed?.schemaVersion !== 1 || parsed.mode !== expected.mode || parsed.season !== expected.season
        || !Array.isArray(parsed.fixtures) || !Array.isArray(parsed.teams) || !Array.isArray(parsed.players)
        || !Array.isArray(parsed.sources) || (expected.season === '2026/27' && !Array.isArray(parsed.absences))
        || !parsed.coverage || typeof parsed.coverage !== 'object' || Array.isArray(parsed.coverage)) return null;
      try {
        const cache = await caches.open(dataName);
        await cache.put(url, response.clone());
      } catch {
        // A full cache must not prevent an online load.
      }
      return response;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function serveDataset(url, expected) {
    const fresh = await refreshDataset(url, expected);
    if (fresh) return fresh;
    const saved = await caches.match(url, { cacheName: dataName }).catch(() => null);
    if (!saved) return new Response(null, { status: 503 });
    return new Response(saved.body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Fantalab-Offline': '1' }
    });
  }

  self.addEventListener('install', event => {
    event.waitUntil((async () => {
      const shell = await caches.open(shellName);
      await shell.addAll(SHELL.map(({ path, integrity }) =>
        new Request(new URL(path, scope), { integrity, cache: 'reload', redirect: 'error' })));
      await Promise.all(Object.entries(DATASETS).map(async ([path, expected]) => {
        const url = new URL(path, scope).href;
        if (!await caches.match(url, { cacheName: dataName })) await refreshDataset(url, expected);
        if (expected.season === '2026/27' && !await caches.match(url, { cacheName: dataName })) {
          throw new Error('Archivio offline non disponibile.');
        }
      }));
    })());
  });

  self.addEventListener('activate', event => {
    event.waitUntil((async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(shellPrefix) && name !== shellName) await caches.delete(name);
      }
      await self.clients.claim();
    })());
  });

  self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
    const url = new URL(request.url);
    url.search = '';
    const address = url.href;
    const path = address.slice(scope.length);
    if (request.mode === 'navigate' && (address === scope || address === index)) {
      event.respondWith(caches.match(index, { cacheName: shellName }).then(response => response ?? fetch(request)));
    } else if (Object.hasOwn(DATASETS, path)) {
      event.respondWith(serveDataset(address, DATASETS[path]));
    } else if (shellUrls.has(address)) {
      event.respondWith(caches.match(address, { cacheName: shellName }).then(response => response ?? fetch(request)));
    }
  });
}
