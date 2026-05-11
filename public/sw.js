/**
 * Self-destruct service worker.
 *
 * The previous Mission Control SW was a "cache everything that isn't /api/*"
 * worker. It silently kept stale JS bundles around for every visitor that
 * had it registered, which made deploys appear to "not stick" (e.g. the
 * Files workspace switcher staying on the old, broken behaviour even after
 * the fix shipped).
 *
 * This SW takes over from the old one, unregisters itself, and wipes every
 * Cache Storage entry on the way out. Once a browser has run it, no future
 * caching happens — Mission Control falls back to plain HTTP caching, which
 * is what we want for an internal dashboard.
 *
 * Safe to delete this file once we're confident every browser has cleared
 * its old SW. Until then, leaving it here ensures returning visitors get
 * a clean state on their next refresh.
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clear every named cache we may have populated previously.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));

      // Take control of any open pages so they go through the no-op fetch
      // handler immediately instead of the old caching one.
      await self.clients.claim();

      // Self-unregister. Pages already open will keep this worker as their
      // controller until they reload; new loads will see no SW at all.
      try {
        await self.registration.unregister();
      } catch (_) {
        // Ignore — some browsers reject in install/activate; the registration
        // will still go away on the next reload.
      }
    })(),
  );
});

// Pass-through fetch handler. We don't cache anything; this exists only so
// the worker stays "alive" enough to run the activate handler above on the
// page that opened it.
self.addEventListener('fetch', () => {});
