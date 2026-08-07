/* ============================================================
   main.js — boots the app: views, filters, edit mode, hearts.
   ============================================================ */

import * as store from './store.js';
import { renderTimeline, renderGallery, initLightbox, openLightboxForMemory, ensureMemoryRendered } from './timeline.js';
import {
	initMap, invalidateMap, renderMarkers, renderLegend,
	fitAllMarkers, flyToMemory, getBasemaps, getBasemap, setBasemap,
} from './map.js';
import {
	openPinModal, initPinPad, openEditor, initEditor,
	openTagManager, initTagManager, showToast, confirmDialog,
} from './editor.js';

const state = {
	view: 'timeline',
	tagFilter: null, // tag id or null = all
	editMode: sessionStorage.getItem('ff-unlocked') === '1',
	mapShownOnce: false,
};

const $ = (id) => document.getElementById(id);

/* ---------- filtering ---------- */

function visibleMemories() {
	const all = store.getMemories();
	if (!state.tagFilter) return all;
	return all.filter((m) => (m.tags || []).includes(state.tagFilter));
}

/* ---------- rendering ---------- */

function cardCallbacks() {
	return {
		editMode: state.editMode,
		onEdit: (id) => openEditor(id),
		onOpenPhoto: (mem, i) => openLightboxForMemory(mem, i),
		onShowOnMap: (id) => { switchView('map'); setTimeout(() => flyToMemory(id), 350); },
		onGoTimeline: (id) => {
			switchView('timeline');
			setTimeout(() => {
				ensureMemoryRendered(id);
				const el = document.querySelector(`[data-mem-id="${CSS.escape(id)}"]`);
				if (el) {
					el.scrollIntoView({ behavior: 'smooth', block: 'center' });
					el.querySelector('.mem-card')?.animate(
						[{ boxShadow: '0 0 0 3px rgba(240,107,168,0.9)' }, { boxShadow: 'none' }],
						{ duration: 1600 }
					);
				}
			}, 400);
		},
	};
}

function renderStats() {
	const couple = store.getCouple();
	const since = new Date(couple.since + 'T00:00:00');
	let days = Math.max(0, Math.floor((Date.now() - since.getTime()) / 86400000));
	// subtract the stretches we had to spend apart
	for (const r of couple.apart || []) {
		const start = Math.max(since.getTime(), new Date(r.from + 'T00:00:00').getTime());
		const end = Math.min(Date.now(), new Date(r.to + 'T00:00:00').getTime());
		if (end > start) days -= Math.floor((end - start) / 86400000);
	}
	const memories = store.getMemories();
	const places = new Set(
		memories.filter((m) => m.place && Number.isFinite(m.place.lat))
			.map((m) => `${m.place.lat.toFixed(3)},${m.place.lng.toFixed(3)}`)
	);
	animateNumber($('stat-days'), days);
	animateNumber($('stat-memories'), memories.length);
	animateNumber($('stat-places'), places.size);
}

function animateNumber(el, target) {
	const dur = 900;
	setTimeout(() => { el.textContent = target.toLocaleString(); }, dur + 120);
	const start = performance.now();
	const tick = (now) => {
		const t = Math.min(1, (now - start) / dur);
		const eased = 1 - Math.pow(1 - t, 3);
		el.textContent = Math.round(target * eased).toLocaleString();
		if (t < 1) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

function renderFilterBar() {
	const bar = $('filter-bar');
	bar.innerHTML = '';
	const all = document.createElement('button');
	all.className = 'chip' + (state.tagFilter === null ? ' is-active' : '');
	all.textContent = 'All';
	all.addEventListener('click', () => { state.tagFilter = null; renderAll(); });
	bar.appendChild(all);
	for (const t of store.getTags()) {
		const b = document.createElement('button');
		b.className = 'chip' + (state.tagFilter === t.id ? ' is-active' : '');
		b.style.setProperty('--chip-color', t.color);
		b.textContent = `${t.emoji || ''} ${t.name}`.trim();
		b.addEventListener('click', () => {
			state.tagFilter = state.tagFilter === t.id ? null : t.id;
			renderAll();
		});
		bar.appendChild(b);
	}
}

function renderAll() {
	const memories = visibleMemories();
	const cbs = cardCallbacks();
	renderStats();
	renderFilterBar();
	renderTimeline($('timeline'), memories, cbs);
	renderGallery($('gallery'), memories, cbs);
	renderMarkers(memories, cbs);
	renderLegend($('map-legend'));
}

/* ---------- views ---------- */

function switchView(view) {
	if (!['timeline', 'map', 'gallery'].includes(view)) view = 'timeline';
	state.view = view;
	document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
	document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
	$('hero').style.display = view === 'timeline' ? '' : 'none';
	document.body.classList.toggle('map-active', view === 'map');
	if (location.hash !== `#/${view}`) history.replaceState(null, '', `#/${view}`);
	if (view === 'map') {
		invalidateMap();
		if (!state.mapShownOnce) {
			state.mapShownOnce = true;
			setTimeout(fitAllMarkers, 250);
		}
	}
}

/* ---------- edit mode ---------- */

const SVG_LOCK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const SVG_UNLOCK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.4"/></svg>';

function setEditMode(on) {
	state.editMode = on;
	sessionStorage.setItem('ff-unlocked', on ? '1' : '0');
	$('edit-toolbar').hidden = !on;
	const lockBtn = $('btn-edit-lock');
	lockBtn.classList.toggle('is-unlocked', on);
	lockBtn.querySelector('.lock-icon').innerHTML = on ? SVG_UNLOCK : SVG_LOCK;
	lockBtn.querySelector('.lock-label').textContent = on ? 'Editing' : 'Edit';
	renderAll();
}

/* ---------- floating hearts (vector-drawn, soft & subtle) ---------- */

function startHearts() {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const canvas = $('hearts-canvas');
	const ctx = canvas.getContext('2d');
	const COLORS = ['#e08e9f', '#d9a05b', '#c9a6d8', '#eaa9b8'];
	const DPR = Math.min(devicePixelRatio || 1, 2);
	let parts = [];
	let w, h;
	let cleared = false;

	const resize = () => {
		const W = innerWidth * DPR;
		const H = innerHeight * DPR;
		// ignore the mobile URL-bar height wobble — resetting the canvas mid-scroll flickers
		if (W === w && Math.abs(H - (h || 0)) < 160 * DPR) return;
		w = canvas.width = W;
		h = canvas.height = H;
	};
	resize();
	addEventListener('resize', resize);

	const spawn = () => ({
		x: Math.random() * w,
		y: h + 30 * DPR,
		size: (7 + Math.random() * 11) * DPR,
		speed: (0.2 + Math.random() * 0.45) * DPR,
		sway: (12 + Math.random() * 22) * DPR,
		phase: Math.random() * Math.PI * 2,
		rot: (Math.random() - 0.5) * 0.6,
		alpha: 0.06 + Math.random() * 0.1,
		color: COLORS[Math.floor(Math.random() * COLORS.length)],
	});

	parts = Array.from({ length: 16 }, () => {
		const p = spawn();
		p.y = Math.random() * h;
		return p;
	});

	const drawHeart = (p) => {
		ctx.save();
		ctx.translate(p.x + Math.sin(p.phase) * p.sway, p.y);
		ctx.rotate(p.rot + Math.sin(p.phase) * 0.15);
		ctx.scale(p.size / 16, p.size / 16);
		ctx.globalAlpha = p.alpha;
		ctx.fillStyle = p.color;
		ctx.beginPath();
		ctx.moveTo(0, 6);
		ctx.bezierCurveTo(-10, -2, -7, -12, 0, -6);
		ctx.bezierCurveTo(7, -12, 10, -2, 0, 6);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	};

	const frame = () => {
		// stand down while the map is up or the tab is hidden — keeps panning smooth
		if (document.hidden || document.body.classList.contains('map-active')) {
			if (!cleared) { ctx.clearRect(0, 0, w, h); cleared = true; }
			setTimeout(() => requestAnimationFrame(frame), 400);
			return;
		}
		cleared = false;
		ctx.clearRect(0, 0, w, h);
		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			p.y -= p.speed;
			p.phase += 0.008;
			if (p.y < -40 * DPR) parts[i] = spawn();
			drawHeart(p);
		}
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
}

/* ---------- boot ---------- */

async function boot() {
	await store.init();

	initMap();
	initLightbox();
	initPinPad();
	initEditor();
	initTagManager();

	// nav tabs
	document.querySelectorAll('.tab').forEach((t) =>
		t.addEventListener('click', () => switchView(t.dataset.view)));
	addEventListener('hashchange', () => switchView(location.hash.replace(/^#\/?/, '')));

	// generic modal close buttons; backdrop click closes pin/tags only
	document.querySelectorAll('[data-close]').forEach((b) =>
		b.addEventListener('click', () => { b.closest('.modal').hidden = true; }));
	['modal-pin', 'modal-tags'].forEach((id) =>
		$(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).hidden = true; }));

	// edit mode
	$('btn-edit-lock').addEventListener('click', () => {
		if (state.editMode) setEditMode(false);
		else openPinModal(() => { setEditMode(true); showToast('Welcome back, love ♥︎ edit mode is on'); });
	});
	$('btn-lock').addEventListener('click', () => setEditMode(false));
	$('btn-add-memory').addEventListener('click', () => openEditor(null));
	$('btn-manage-tags').addEventListener('click', openTagManager);
	$('btn-map-fit').addEventListener('click', fitAllMarkers);

	// basemap style switcher
	const msOptions = $('ms-options');
	const renderBasemapOptions = () => {
		msOptions.innerHTML = '';
		for (const b of getBasemaps()) {
			const btn = document.createElement('button');
			btn.className = 'ms-opt' + (getBasemap() === b.id ? ' is-active' : '');
			btn.textContent = b.name;
			btn.addEventListener('click', () => {
				setBasemap(b.id);
				renderBasemapOptions();
				msOptions.hidden = true;
			});
			msOptions.appendChild(btn);
		}
	};
	renderBasemapOptions();
	$('ms-toggle').addEventListener('click', () => { msOptions.hidden = !msOptions.hidden; });
	document.addEventListener('click', (e) => {
		if (!e.target.closest('.map-style')) msOptions.hidden = true;
	});

	// export / import / reset
	$('btn-export').addEventListener('click', async () => {
		await store.downloadExport();
		showToast('memories.json downloaded — replace data/memories.json in the repo to publish');
	});
	$('btn-import').addEventListener('click', () => $('import-file').click());
	$('import-file').addEventListener('change', async (e) => {
		const file = e.target.files[0];
		e.target.value = '';
		if (!file) return;
		try {
			const doc = JSON.parse(await file.text());
			const { added, updated } = await store.importDoc(doc);
			showToast(`Imported: ${added} new, ${updated} updated`);
		} catch (err) {
			console.error(err);
			showToast('That file does not look like a memories.json');
		}
	});
	$('btn-reset-local').addEventListener('click', async () => {
		const sure = await confirmDialog({
			title: 'Reset local edits?',
			message: 'All edits and photos not yet published will be discarded, returning to the published version of our story.',
			confirmLabel: 'Reset',
			danger: true,
			icon: '↺',
		});
		if (!sure) return;
		await store.resetLocal();
		showToast('Back to the published version');
	});

	store.onChange(renderAll);

	setEditMode(state.editMode);
	switchView(location.hash.replace(/^#\/?/, '') || 'timeline');
	startHearts();

	// PWA
	if ('serviceWorker' in navigator && location.protocol === 'https:') {
		navigator.serviceWorker.register('sw.js').catch(() => {});
	}
}

boot().catch((e) => {
	console.error(e);
	showToast('Something went wrong loading our story — try refreshing');
});
