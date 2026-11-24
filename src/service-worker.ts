/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'circuit-lab-cache-';
const CACHE_NAME = `${CACHE_PREFIX}${version}`;
const ASSETS = [...build, ...files, ...prerendered];
const ASSET_SET = new Set(ASSETS);

sw.addEventListener('install', (event) => {
	async function precacheAssets() {
		const cache = await caches.open(CACHE_NAME);
		await cache.addAll(ASSETS);
		await sw.skipWaiting();
	}

	event.waitUntil(precacheAssets());
});

sw.addEventListener('activate', (event) => {
	async function cleanupOldCaches() {
		const keys = await caches.keys();
		await Promise.all(
			keys
				.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
				.map((key) => caches.delete(key))
		);
		await sw.clients.claim();
	}

	event.waitUntil(cleanupOldCaches());
});

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;

	async function respond(): Promise<Response> {
		const cache = await caches.open(CACHE_NAME);

		// Cache-first for immutable precached assets (build chunks + static files)
		if (ASSET_SET.has(url.pathname)) {
			const cachedAsset = await cache.match(url.pathname);
			if (cachedAsset) {
				return cachedAsset;
			}
		}

		// Network-first with cache fallback for HTML navigations
		if (event.request.mode === 'navigate') {
			const indexUrl = new URL('./', sw.registration.scope).href;
			try {
				const response = await fetch(event.request);
				if (response.ok) {
					await cache.put(event.request, response.clone());
					await cache.put(indexUrl, response.clone());
				}
				return response;
			} catch {
				const cachedPage =
					(await cache.match(event.request)) ??
					(await cache.match(indexUrl)) ??
					(prerendered[0] ? await cache.match(prerendered[0]) : undefined);
				if (cachedPage) {
					return cachedPage;
				}
				return new Response('Offline — Circuit Lab is not yet cached for this route.', {
					status: 503,
					statusText: 'Service Unavailable',
					headers: { 'Content-Type': 'text/plain; charset=utf-8' }
				});
			}
		}

		// Network-first with cache fallback for other same-origin GET requests
		try {
			const response = await fetch(event.request);
			if (response.ok && response.type === 'basic') {
				await cache.put(event.request, response.clone());
			}
			return response;
		} catch {
			const cached = await cache.match(event.request);
			if (cached) {
				return cached;
			}
			return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
		}
	}

	event.respondWith(respond());
});
