import { build, version } from '$service-worker';

const name = `cache-${version}`

self.addEventListener('install', (event) => {
	// @ts-expect-error
	event.waitUntil(caches.open(name).then((cache) => cache.addAll(build)))
});

self.addEventListener('activate', (event) => {
	// @ts-expect-error
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (!key.includes(version)) caches.delete(key)
			}
		})
	);
});

self.addEventListener('fetch', event => {
  const { request } = event

  const url = new URL(request.url);
  // If this is an incoming POST request for the
  // registered "action" URL, respond to it.
  if (request.method === 'POST' && url.pathname === '/add') {
    event.respondWith((async () => {
      const formData = await request.formData()
      const link = formData.get('link') || ''
      const responseUrl = await saveBookmark(link)
      return Response.redirect(responseUrl, 303)
    })())
  } else if (request.method !== 'GET' || request.headers.has('range') ) {
    return
  }

  const cached = caches.match(request)

})