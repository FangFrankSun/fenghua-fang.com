/* Service worker — makes the site installable and fast on our phones.
   Strategy: network-first for HTML and data (so updates always land),
   cache-first for everything else (styles, scripts, photos, tiles). */

const VERSION = 'ff-v10';
const SHELL = [
	'./',
	'index.html',
	'app/styles.css',
	'app/main.js',
	'app/store.js',
	'app/timeline.js',
	'app/map.js',
	'app/editor.js',
	'app/icons/icon-192.png',
	'app/icons/icon-512.png',
	'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
	e.waitUntil(
		caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (e) => {
	const req = e.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	const isFresh = req.mode === 'navigate' || url.pathname.endsWith('memories.json');

	if (isFresh) {
		// network-first: always try for the latest story
		e.respondWith(
			fetch(req)
				.then((res) => {
					const copy = res.clone();
					caches.open(VERSION).then((c) => c.put(req, copy));
					return res;
				})
				.catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
		);
		return;
	}

	// cache-first with background fill
	e.respondWith(
		caches.match(req).then((hit) => {
			if (hit) return hit;
			return fetch(req).then((res) => {
				if (res.ok || res.type === 'opaque') {
					const copy = res.clone();
					caches.open(VERSION).then((c) => c.put(req, copy));
				}
				return res;
			});
		})
	);
});
