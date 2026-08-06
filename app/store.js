/* ============================================================
   store.js — data layer.
   The published baseline lives in data/memories.json (committed
   to the repo). Local edits live in IndexedDB as an overlay and
   win over the baseline. Export produces a new memories.json
   (photos embedded as data URLs) ready to commit for both of us.
   ============================================================ */

const DB_NAME = 'ff-love-db';
const DB_VERSION = 1;

let db = null;
let seed = { version: 2, couple: { names: 'Fenghua & Fang', since: '2021-12-19' }, tags: [], memories: [] };
let overlay = { memories: {}, tags: null, couple: null };

const photoURLCache = new Map(); // photoId -> object URL
const listeners = new Set();

/* ---------- tiny utils ---------- */

export function uid(prefix = 'm') {
	const rand = (crypto.randomUUID && crypto.randomUUID().slice(0, 8)) ||
		Math.random().toString(36).slice(2, 10);
	return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function escapeHtml(s) {
	return String(s ?? '')
		.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function formatDate(iso) {
	if (!iso) return '';
	const d = new Date(iso + 'T12:00:00');
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ---------- IndexedDB ---------- */

function openDB() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const d = req.result;
			if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
			if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function idb(storeName, mode, fn) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, mode);
		const store = tx.objectStore(storeName);
		const out = fn(store);
		tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
		tx.onerror = () => reject(tx.error);
	});
}

const kvGet = (key) => idb('kv', 'readonly', (s) => s.get(key));
const kvSet = (key, val) => idb('kv', 'readwrite', (s) => s.put(val, key));
const photoGet = (id) => idb('photos', 'readonly', (s) => s.get(id));
const photoPut = (id, blob) => idb('photos', 'readwrite', (s) => s.put(blob, id));
const photoDel = (id) => idb('photos', 'readwrite', (s) => s.delete(id));

async function saveOverlay() {
	await kvSet('overlay', overlay);
}

/* ---------- init ---------- */

export async function init() {
	db = await openDB();
	try {
		const res = await fetch('data/memories.json', { cache: 'no-cache' });
		if (res.ok) seed = await res.json();
	} catch (e) {
		console.warn('Could not load seed data — starting from local data only.', e);
	}
	const saved = await kvGet('overlay');
	if (saved && typeof saved === 'object') {
		overlay = { memories: {}, tags: null, couple: null, ...saved };
	}
}

/* ---------- change events ---------- */

export function onChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach((fn) => fn()); }

/* ---------- reads ---------- */

export function getCouple() {
	return overlay.couple || seed.couple || { names: 'Fenghua & Fang', since: '2021-12-19' };
}

export function getTags() {
	return (overlay.tags || seed.tags || []).slice();
}

export function getTag(id) {
	return getTags().find((t) => t.id === id) || null;
}

export function getMemories() {
	const map = new Map();
	for (const m of seed.memories || []) map.set(m.id, m);
	for (const [id, m] of Object.entries(overlay.memories || {})) {
		if (m && m.__deleted) map.delete(id);
		else if (m) map.set(id, m);
	}
	return [...map.values()].sort((a, b) => {
		const ka = `${a.date || ''}T${a.time || '00:00'}`;
		const kb = `${b.date || ''}T${b.time || '00:00'}`;
		return ka < kb ? -1 : ka > kb ? 1 : 0;
	});
}

export function getMemory(id) {
	return getMemories().find((m) => m.id === id) || null;
}

export function hasLocalEdits() {
	return Object.keys(overlay.memories || {}).length > 0 || overlay.tags !== null;
}

/* ---------- photo resolution ---------- */

export async function resolvePhotoURL(photo) {
	const src = photo?.src || '';
	if (!src.startsWith('idb:')) return src; // repo path or data URL
	const id = src.slice(4);
	if (photoURLCache.has(id)) return photoURLCache.get(id);
	const blob = await photoGet(id);
	if (!blob) return '';
	const url = URL.createObjectURL(blob);
	photoURLCache.set(id, url);
	return url;
}

export async function storePhotoBlob(blob) {
	const id = uid('p');
	await photoPut(id, blob);
	return { id, src: `idb:${id}` };
}

export async function deletePhotoBlob(id) {
	await photoDel(id).catch(() => {});
	const url = photoURLCache.get(id);
	if (url) {
		URL.revokeObjectURL(url);
		photoURLCache.delete(id);
	}
}

/* ---------- writes ---------- */

export async function upsertMemory(mem) {
	mem.updatedAt = new Date().toISOString();
	overlay.memories[mem.id] = mem;
	await saveOverlay();
	emit();
}

export async function deleteMemory(id) {
	const mem = getMemory(id);
	if (mem) {
		for (const p of mem.photos || []) {
			if (p.src && p.src.startsWith('idb:')) await photoDel(p.src.slice(4)).catch(() => {});
		}
	}
	overlay.memories[id] = { __deleted: true, updatedAt: new Date().toISOString() };
	await saveOverlay();
	emit();
}

export async function setTags(tags) {
	overlay.tags = tags;
	await saveOverlay();
	emit();
}

export async function resetLocal() {
	overlay = { memories: {}, tags: null, couple: null };
	await saveOverlay();
	await idb('photos', 'readwrite', (s) => s.clear());
	for (const url of photoURLCache.values()) URL.revokeObjectURL(url);
	photoURLCache.clear();
	emit();
}

/* ---------- export / import ---------- */

function blobToDataURL(blob) {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result);
		r.onerror = () => reject(r.error);
		r.readAsDataURL(blob);
	});
}

function dataURLToBlob(dataURL) {
	const [head, body] = dataURL.split(',');
	const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
	const bin = atob(body);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: mime });
}

export async function exportDoc() {
	const memories = [];
	for (const m of getMemories()) {
		const copy = { ...m, photos: [] };
		for (const p of m.photos || []) {
			if (p.src && p.src.startsWith('idb:')) {
				const blob = await photoGet(p.src.slice(4));
				if (blob) copy.photos.push({ id: p.id, src: await blobToDataURL(blob) });
			} else {
				copy.photos.push({ ...p });
			}
		}
		memories.push(copy);
	}
	return { version: 2, couple: getCouple(), tags: getTags(), memories };
}

export async function downloadExport() {
	const doc = await exportDoc();
	const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = 'memories.json';
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function importDoc(doc) {
	if (!doc || !Array.isArray(doc.memories)) throw new Error('Not a valid memories.json file');
	const current = new Map(getMemories().map((m) => [m.id, m]));
	let added = 0, updated = 0;

	for (const incoming of doc.memories) {
		if (!incoming.id) incoming.id = uid('m');
		const existing = current.get(incoming.id);
		const incomingAt = incoming.updatedAt || '';
		const existingAt = existing?.updatedAt || '';
		if (existing && incomingAt <= existingAt) continue; // ours is newer or same

		// convert embedded data-URL photos into local blobs
		const photos = [];
		for (const p of incoming.photos || []) {
			if (p.src && p.src.startsWith('data:')) {
				const stored = await storePhotoBlob(dataURLToBlob(p.src));
				photos.push(stored);
			} else if (p.src) {
				photos.push({ ...p });
			}
		}
		incoming.photos = photos;
		overlay.memories[incoming.id] = incoming;
		existing ? updated++ : added++;
	}

	if (Array.isArray(doc.tags) && doc.tags.length) {
		if (!overlay.tags) {
			overlay.tags = doc.tags;
		} else {
			const mine = new Map(overlay.tags.map((t) => [t.id, t]));
			for (const t of doc.tags) mine.set(t.id, t);
			overlay.tags = [...mine.values()];
		}
	}

	await saveOverlay();
	emit();
	return { added, updated };
}
