/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'

export const SW_VERSION = '1.1.21';

clientsClaim()

self.addEventListener('message', (event) => {
   if (event.data && event.data.type === 'SKIP_WAITING') {
      // when user clicks on the update link?
      self.skipWaiting();

   } else if (event.data === 'GET_VERSION') {
      // when app ask for version number
      event.source.postMessage({ type: 'VERSION', version: SW_VERSION });
   }
})

// self.__WB_MANIFEST is the default injection point
precacheAndRoute(self.__WB_MANIFEST)

// Runtime font caching — safety net for any font not in the precache manifest
registerRoute(
   ({ request }) => request.destination === 'font',
   new CacheFirst({
      cacheName: 'fonts',
      plugins: [
         new CacheableResponsePlugin({ statuses: [0, 200] }),
         new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 365 }),
      ],
   }),
)

////////  COPIED FROM A VITE-VUE-PWA SCAFOLDING EXAMPLE

// clean old assets
cleanupOutdatedCaches()

/** @type {RegExp[] | undefined} */
let allowlist
// in dev mode, we disable precaching to avoid caching issues
if (import.meta.env.DEV)
   allowlist = [/^\/$/]

// to allow work offline
registerRoute(new NavigationRoute(
   createHandlerBoundToURL('index.html'),
   { allowlist },
))
