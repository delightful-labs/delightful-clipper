import { build, version } from '$service-worker';

const name = `cache-${version}`;

self.addEventListener('install', (event) => {
	// @ts-expect-error
	event.waitUntil(caches.open(name).then((cache) => cache.addAll(build)));
});

self.addEventListener('activate', (event) => {
	// @ts-expect-error
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (!key.includes(version)) caches.delete(key);
			}
		})
	);
});

self.addEventListener('fetch', (event) => {
	// @ts-expect-error
	const { request } = event;
  const url = new URL(request.url);

	if (request.method !== 'GET' || request.headers.has('range') || url.pathname === '/add') return;

	const cached = caches.match(request);

	if (url.origin === location.origin && build.includes(url.pathname)) {
		// always return build files from cache
		// @ts-expect-error
		event.respondWith(cached);
	} else if (url.protocol === 'https:' || location.hostname === 'localhost') {
		// hit the network for everything else...
		const promise = fetch(request);

		// ...and cache successful responses...
		promise.then((response) => {
			// cache successful responses
			if (response.ok && response.type === 'basic') {
				const clone = response.clone();
				caches.open(name).then((cache) => {
					cache.put(request, clone);
				});
			}
		});

		// ...but if it fails, fall back to cache if available
		// @ts-expect-error
		event.respondWith(promise.catch(() => cached || promise));
	}
});


self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // If this is an incoming POST request for the
  // registered "action" URL, respond to it.
  if (event.request.method === 'POST' && url.pathname === '/add') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const link = formData.get('link') || '';
      const responseUrl = await saveBookmark(link);
      return Response.redirect(responseUrl, 303);
    })());
  }
});