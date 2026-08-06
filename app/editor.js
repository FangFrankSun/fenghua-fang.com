/* ============================================================
   editor.js — the secret door (PIN pad), the memory editor
   (photos, place search, tags), and the tag manager.
   ============================================================ */

import {
	escapeHtml, uid, getTags, getMemory,
	upsertMemory, deleteMemory, setTags, storePhotoBlob, deletePhotoBlob, resolvePhotoURL,
} from './store.js';
import { geocode, reverseGeocode } from './map.js';

/* ---------- toast ---------- */

let toastTimer = null;
export function showToast(msg) {
	const t = document.getElementById('toast');
	t.textContent = msg;
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- confirm dialog (replaces the browser's plain confirm) ---------- */

let confirmResolve = null;

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, icon = '♥︎' }) {
	return new Promise((resolve) => {
		confirmResolve = resolve;
		const card = document.querySelector('#modal-confirm .confirm-card');
		card.classList.toggle('is-danger', danger);
		document.getElementById('confirm-icon').textContent = icon;
		document.getElementById('confirm-title').textContent = title;
		document.getElementById('confirm-msg').textContent = message;
		const ok = document.getElementById('confirm-ok');
		ok.textContent = confirmLabel;
		ok.className = 'btn ' + (danger ? 'btn-danger-fill' : 'btn-primary');
		document.getElementById('modal-confirm').hidden = false;
	});
}

function initConfirm() {
	const modal = document.getElementById('modal-confirm');
	const close = (val) => {
		modal.hidden = true;
		confirmResolve?.(val);
		confirmResolve = null;
	};
	document.getElementById('confirm-ok').addEventListener('click', () => close(true));
	document.getElementById('confirm-cancel').addEventListener('click', () => close(false));
	modal.addEventListener('click', (e) => { if (e.target === modal) close(false); });
	document.addEventListener('keydown', (e) => {
		if (!modal.hidden && e.key === 'Escape') close(false);
	});
}

/* ============================================================
   PIN pad — the code is never stored anywhere, only a salted
   SHA-256 fingerprint of it. Only the two of us know it.
   ============================================================ */

const PIN_SALT = 'ff-love::';
const PIN_HASH = '45a0a49c85e2cc9dfda671e6c20614da4632d0a251f80272507d69fc0d5f96d2';
const PIN_LENGTH = 6;

let pinBuffer = '';
let pinOnSuccess = null;

async function pinMatches(pin) {
	if (!crypto.subtle) return false;
	const data = new TextEncoder().encode(PIN_SALT + pin);
	const digest = await crypto.subtle.digest('SHA-256', data);
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return hex === PIN_HASH;
}

function renderPinDots() {
	document.querySelectorAll('#pin-dots .pin-dot').forEach((dot, i) => {
		dot.classList.toggle('is-filled', i < pinBuffer.length);
	});
}

export function openPinModal(onSuccess) {
	pinOnSuccess = onSuccess;
	pinBuffer = '';
	renderPinDots();
	document.getElementById('modal-pin').hidden = false;
}

async function pushPinDigit(d) {
	if (pinBuffer.length >= PIN_LENGTH) return;
	pinBuffer += d;
	renderPinDots();
	if (pinBuffer.length === PIN_LENGTH) {
		const card = document.querySelector('#modal-pin .pin-card');
		if (await pinMatches(pinBuffer)) {
			document.getElementById('modal-pin').hidden = true;
			pinBuffer = '';
			pinOnSuccess?.();
		} else {
			card.classList.add('is-wrong');
			setTimeout(() => {
				card.classList.remove('is-wrong');
				pinBuffer = '';
				renderPinDots();
			}, 500);
		}
	}
}

export function initPinPad() {
	document.getElementById('pin-pad').addEventListener('click', (e) => {
		const btn = e.target.closest('button');
		if (!btn) return;
		if (btn.hasAttribute('data-del')) {
			pinBuffer = pinBuffer.slice(0, -1);
			renderPinDots();
		} else if (btn.dataset.d != null) {
			pushPinDigit(btn.dataset.d);
		}
	});
	document.addEventListener('keydown', (e) => {
		const modal = document.getElementById('modal-pin');
		if (modal.hidden) return;
		if (/^[0-9]$/.test(e.key)) pushPinDigit(e.key);
		if (e.key === 'Backspace') { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); }
		if (e.key === 'Escape') modal.hidden = true;
	});
}

/* ============================================================
   Memory editor
   ============================================================ */

const ed = {
	id: null,
	photos: [],          // [{id, src}]
	addedPhotoIds: [],   // stored this session; deleted again if user cancels
	removedPhotos: [],   // photos removed from an existing memory; blobs freed on save
	place: null,
	minimap: null,
	minimapMarker: null,
	saved: false,
};

const $ = (id) => document.getElementById(id);

function renderTagPicker(selected) {
	const wrap = $('f-tags');
	wrap.innerHTML = '';
	for (const t of getTags()) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'tag-opt' + (selected.includes(t.id) ? ' is-on' : '');
		b.style.setProperty('--chip-color', t.color);
		b.dataset.id = t.id;
		b.innerHTML = `${escapeHtml(t.emoji || '')} ${escapeHtml(t.name)}`;
		b.addEventListener('click', () => b.classList.toggle('is-on'));
		wrap.appendChild(b);
	}
}

function renderPhotoGrid() {
	const grid = $('f-photos');
	grid.innerHTML = '';
	ed.photos.forEach((p, i) => {
		const item = document.createElement('div');
		item.className = 'pg-item';
		const img = document.createElement('img');
		img.alt = '';
		resolvePhotoURL(p).then((u) => { if (u) img.src = u; });
		const rm = document.createElement('button');
		rm.type = 'button';
		rm.className = 'pg-remove';
		rm.textContent = '×';
		rm.title = 'Remove photo';
		rm.addEventListener('click', () => {
			ed.removedPhotos.push(p);
			ed.photos.splice(i, 1);
			renderPhotoGrid();
		});
		item.append(img, rm);
		grid.appendChild(item);
	});
}

/* ---------- photo intake ---------- */

async function compressImage(file, maxDim = 1600, quality = 0.82) {
	let bitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		bitmap = await new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = URL.createObjectURL(file);
		});
	}
	const w0 = bitmap.width || bitmap.naturalWidth;
	const h0 = bitmap.height || bitmap.naturalHeight;
	const scale = Math.min(1, maxDim / Math.max(w0, h0));
	const w = Math.max(1, Math.round(w0 * scale));
	const h = Math.max(1, Math.round(h0 * scale));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
	const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
	return blob || file;
}

async function addFiles(fileList) {
	const files = [...fileList].filter((f) => f.type.startsWith('image/'));
	if (!files.length) return;
	showToast(`Adding ${files.length} photo${files.length > 1 ? 's' : ''}…`);
	for (const f of files) {
		try {
			const blob = await compressImage(f);
			const stored = await storePhotoBlob(blob);
			ed.photos.push(stored);
			ed.addedPhotoIds.push(stored.src.slice(4));
		} catch (e) {
			console.error(e);
			showToast(`Couldn't read ${f.name}`);
		}
	}
	renderPhotoGrid();
}

/* ---------- place picker ---------- */

let searchTimer = null;

function setPlace(place) {
	ed.place = place;
	const cur = $('f-place-current');
	const mapEl = $('f-minimap');
	if (!place) {
		cur.hidden = true;
		mapEl.hidden = true;
		return;
	}
	cur.hidden = false;
	$('f-place-name').textContent = place.name || `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;
	if (typeof L === 'undefined') return;
	mapEl.hidden = false;

	if (!ed.minimap) {
		ed.minimap = L.map('f-minimap', { zoomControl: false, attributionControl: false });
		L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd' }).addTo(ed.minimap);
		ed.minimapMarker = L.marker([0, 0], { draggable: true }).addTo(ed.minimap);
		ed.minimapMarker.on('dragend', async () => {
			const ll = ed.minimapMarker.getLatLng();
			await updatePlaceFromLatLng(ll.lat, ll.lng);
		});
		ed.minimap.on('click', async (e) => {
			ed.minimapMarker.setLatLng(e.latlng);
			await updatePlaceFromLatLng(e.latlng.lat, e.latlng.lng);
		});
	}
	ed.minimapMarker.setLatLng([place.lat, place.lng]);
	setTimeout(() => {
		ed.minimap.invalidateSize();
		ed.minimap.setView([place.lat, place.lng], 12);
	}, 60);
}

async function updatePlaceFromLatLng(lat, lng) {
	const name = await reverseGeocode(lat, lng);
	ed.place = { name: name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng };
	$('f-place-name').textContent = ed.place.name;
}

function initPlaceSearch() {
	const input = $('f-place-search');
	const results = $('f-place-results');

	input.addEventListener('input', () => {
		clearTimeout(searchTimer);
		const q = input.value.trim();
		if (q.length < 3) { results.hidden = true; return; }
		searchTimer = setTimeout(async () => {
			try {
				const rows = await geocode(q);
				results.innerHTML = '';
				if (!rows.length) {
					results.innerHTML = `<div class="place-result">No places found</div>`;
				}
				for (const r of rows) {
					const b = document.createElement('button');
					b.type = 'button';
					b.className = 'place-result';
					b.innerHTML = `${escapeHtml(r.name)}<span class="pr-sub">${escapeHtml(r.full)}</span>`;
					b.addEventListener('click', () => {
						setPlace({ name: r.name, lat: r.lat, lng: r.lng });
						results.hidden = true;
						input.value = '';
					});
					results.appendChild(b);
				}
				results.hidden = false;
			} catch {
				showToast('Place search is unavailable right now');
			}
		}, 450);
	});

	document.addEventListener('click', (e) => {
		if (!e.target.closest('.place-search-wrap')) results.hidden = true;
	});

	$('f-place-remove').addEventListener('click', () => setPlace(null));
}

/* ---------- open / save / delete ---------- */

export function openEditor(memId = null) {
	const mem = memId ? getMemory(memId) : null;
	ed.id = mem?.id || null;
	ed.photos = (mem?.photos || []).map((p) => ({ ...p }));
	ed.addedPhotoIds = [];
	ed.removedPhotos = [];
	ed.saved = false;

	$('editor-heading').textContent = mem ? 'Edit memory' : 'New memory';
	$('f-title').value = mem?.title || '';
	$('f-date').value = mem?.date || new Date().toISOString().slice(0, 10);
	$('f-time').value = mem?.time || '';
	$('f-desc').value = mem?.description || '';
	$('f-place-search').value = '';
	$('f-place-results').hidden = true;
	renderTagPicker(mem?.tags || []);
	renderPhotoGrid();
	setPlace(mem?.place && Number.isFinite(mem.place.lat) ? { ...mem.place } : null);
	$('f-delete').hidden = !mem;

	document.getElementById('modal-editor').hidden = false;
}

async function saveEditor() {
	const title = $('f-title').value.trim();
	const date = $('f-date').value;
	if (!title) { showToast('Give this memory a title'); return; }
	if (!date) { showToast('When did it happen? Pick a date'); return; }

	const tags = [...document.querySelectorAll('#f-tags .tag-opt.is-on')].map((b) => b.dataset.id);
	const mem = {
		id: ed.id || uid('m'),
		title,
		date,
		time: $('f-time').value || undefined,
		description: $('f-desc').value.trim() || undefined,
		place: ed.place ? { name: ed.place.name, lat: ed.place.lat, lng: ed.place.lng } : undefined,
		tags,
		photos: ed.photos,
	};

	await upsertMemory(mem);
	for (const p of ed.removedPhotos) {
		if (p.src && p.src.startsWith('idb:')) deletePhotoBlob(p.src.slice(4));
	}
	ed.saved = true;
	document.getElementById('modal-editor').hidden = true;
	showToast('Saved ♥︎ Use Export when you want to publish it for both of us');
}

export function initEditor() {
	initConfirm();
	initPlaceSearch();

	$('f-save').addEventListener('click', saveEditor);

	$('f-delete').addEventListener('click', async () => {
		if (!ed.id) return;
		const sure = await confirmDialog({
			title: 'Delete this memory?',
			message: 'It will disappear from our story. This cannot be undone.',
			confirmLabel: 'Delete',
			danger: true,
			icon: '✕',
		});
		if (!sure) return;
		await deleteMemory(ed.id);
		ed.saved = true;
		document.getElementById('modal-editor').hidden = true;
		showToast('Memory deleted');
	});

	// photo intake: browse + drop + paste
	$('f-browse').addEventListener('click', () => $('f-file').click());
	$('f-file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

	const dz = $('f-dropzone');
	['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
		e.preventDefault();
		dz.classList.add('is-over');
	}));
	['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
		e.preventDefault();
		dz.classList.remove('is-over');
	}));
	dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

	// if the editor closes without saving, free photos added this session
	const modal = document.getElementById('modal-editor');
	new MutationObserver(() => {
		if (modal.hidden && !ed.saved && ed.addedPhotoIds.length) {
			ed.addedPhotoIds.forEach((id) => deletePhotoBlob(id));
			ed.addedPhotoIds = [];
		}
	}).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
}

/* ============================================================
   Tag manager
   ============================================================ */

function tagRow(tag) {
	const row = document.createElement('div');
	row.className = 'tag-row';
	row.dataset.id = tag.id || '';
	row.innerHTML = `
		<input type="color" value="${escapeHtml(tag.color || '#f06ba8')}" title="Pin & chip color" />
		<input type="text" class="tr-emoji" value="${escapeHtml(tag.emoji || '')}" placeholder="♥" maxlength="4" title="Symbol (optional)" />
		<input type="text" class="tr-name" value="${escapeHtml(tag.name || '')}" placeholder="Tag name" maxlength="24" />
		<button type="button" class="tr-del" title="Delete tag">🗑</button>
	`;
	row.querySelector('.tr-del').addEventListener('click', () => row.remove());
	return row;
}

export function openTagManager() {
	const wrap = document.getElementById('tag-rows');
	wrap.innerHTML = '';
	for (const t of getTags()) wrap.appendChild(tagRow(t));
	document.getElementById('modal-tags').hidden = false;
}

export function initTagManager() {
	document.getElementById('btn-tag-add').addEventListener('click', () => {
		document.getElementById('tag-rows').appendChild(tagRow({ color: '#f06ba8' }));
	});

	document.getElementById('btn-tags-save').addEventListener('click', async () => {
		const rows = [...document.querySelectorAll('#tag-rows .tag-row')];
		const tags = [];
		const seen = new Set();
		for (const row of rows) {
			const name = row.querySelector('.tr-name').value.trim();
			if (!name) continue;
			let id = row.dataset.id;
			if (!id) {
				id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || uid('t');
				while (seen.has(id)) id += '-2';
			}
			seen.add(id);
			tags.push({
				id,
				name,
				emoji: row.querySelector('.tr-emoji').value.trim(),
				color: row.querySelector('input[type="color"]').value,
			});
		}
		await setTags(tags);
		document.getElementById('modal-tags').hidden = true;
		showToast('Tags updated');
	});
}
