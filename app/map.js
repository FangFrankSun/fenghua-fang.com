/* ============================================================
   map.js — the world map of us. Leaflet + CARTO Voyager tiles,
   heart-warm pins colored by tag, photo popups, geocoding.
   ============================================================ */

import { escapeHtml, formatDate, getTag, getTags, resolvePhotoURL } from './store.js';

let map = null;
let markerLayer = null;
let tileLayer = null;
let labelLayer = null;
const markersById = new Map();

const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

/* selectable basemap styles — all free, no API key */
const BASEMAPS = [
	{ id: 'warm', name: 'Warm', url: TILE_URL, subdomains: 'abcd', attr: CARTO_ATTR, maxZoom: 19 },
	{ id: 'minimal', name: 'Minimal', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', subdomains: 'abcd', attr: CARTO_ATTR, maxZoom: 19 },
	{ id: 'vintage', name: 'Vintage', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles &copy; Esri &mdash; National Geographic', maxZoom: 16 },
	{
		id: 'satellite', name: 'Satellite',
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		attr: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics',
		labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
		maxZoom: 19,
	},
];

export function getBasemaps() { return BASEMAPS; }

export function getBasemap() {
	return new URLSearchParams(location.search).get('basemap')
		|| localStorage.getItem('ff-basemap')
		|| 'warm';
}

export function setBasemap(id) {
	const def = BASEMAPS.find((b) => b.id === id) || BASEMAPS[0];
	localStorage.setItem('ff-basemap', def.id);
	if (!map) return;
	if (tileLayer) map.removeLayer(tileLayer);
	if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }
	tileLayer = L.tileLayer(def.url, {
		attribution: def.attr,
		subdomains: def.subdomains || [],
		maxZoom: def.maxZoom,
		keepBuffer: 4,
	}).addTo(map);
	if (def.labels) {
		labelLayer = L.tileLayer(def.labels, { maxZoom: def.maxZoom, keepBuffer: 4 }).addTo(map);
	}
	map.setMaxZoom(def.maxZoom);
}

export function initMap() {
	if (typeof L === 'undefined') return null; // Leaflet CDN unreachable — app still works without the map
	map = L.map('map', {
		center: [30, -40],
		zoom: 3,
		minZoom: 2,
		maxZoom: 19,
		worldCopyJump: true,
		zoomControl: true,
	});
	setBasemap(getBasemap());
	markerLayer = L.layerGroup().addTo(map);
	return map;
}

export function invalidateMap() {
	if (map) setTimeout(() => map.invalidateSize(), 60);
}

function pinIcon(color, emoji) {
	const html = `
		<div class="pin-pulse" style="--pin:${escapeHtml(color)};position:absolute;left:24px;top:24px;"></div>
		<div class="pin" style="--pin:${escapeHtml(color)};position:absolute;left:7px;top:5px;"><span>${escapeHtml(emoji) || '♥︎'}</span></div>
	`;
	return L.divIcon({ className: 'pin-wrap', html, iconSize: [48, 48], iconAnchor: [24, 42], popupAnchor: [0, -40] });
}

function popupContent(mem, { editMode, onEdit, onOpenPhoto, onGoTimeline }) {
	const el = document.createElement('div');
	el.className = 'pop-card';

	if ((mem.photos || []).length) {
		const img = document.createElement('img');
		img.className = 'pop-img';
		img.alt = mem.title || '';
		const first = mem.photos[0];
		resolvePhotoURL(first.thumb ? { src: first.thumb } : first).then((u) => { if (u) img.src = u; });
		img.addEventListener('click', () => onOpenPhoto(mem, 0));
		el.appendChild(img);
	}

	const body = document.createElement('div');
	body.className = 'pop-body';
	const tags = (mem.tags || []).map((id) => getTag(id)).filter(Boolean)
		.map((t) => `<span class="tag-chip" style="--chip-color:${escapeHtml(t.color)}">${escapeHtml(t.emoji || '')} ${escapeHtml(t.name)}</span>`)
		.join('');
	body.innerHTML = `
		<div class="pop-date">${escapeHtml(formatDate(mem.date))}</div>
		<h4 class="pop-title">${escapeHtml(mem.title || 'Untitled')}</h4>
		${mem.description ? `<p class="pop-desc">${escapeHtml(mem.description)}</p>` : ''}
		${tags ? `<div class="pop-tags">${tags}</div>` : ''}
	`;

	const row = document.createElement('div');
	row.style.display = 'flex';
	row.style.gap = '12px';
	const tl = document.createElement('button');
	tl.className = 'pop-link';
	tl.textContent = 'In the timeline →';
	tl.addEventListener('click', () => onGoTimeline(mem.id));
	row.appendChild(tl);
	if (editMode) {
		const ed = document.createElement('button');
		ed.className = 'pop-link';
		ed.textContent = 'Edit';
		ed.addEventListener('click', () => onEdit(mem.id));
		row.appendChild(ed);
	}
	body.appendChild(row);
	el.appendChild(body);
	return el;
}

export function renderMarkers(memories, callbacks) {
	if (!map) return;
	markerLayer.clearLayers();
	markersById.clear();
	for (const mem of memories) {
		const p = mem.place;
		if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
		const tag = getTag((mem.tags || [])[0]);
		const marker = L.marker([p.lat, p.lng], {
			icon: pinIcon(tag?.color || '#f06ba8', tag?.emoji),
			title: mem.title || '',
		});
		marker.bindPopup(() => popupContent(mem, callbacks), { closeButton: true, maxWidth: 270 });
		marker.addTo(markerLayer);
		markersById.set(mem.id, marker);
	}
}

export function renderLegend(container) {
	container.innerHTML = getTags()
		.map((t) => `<div class="legend-row"><span class="legend-swatch" style="background:${escapeHtml(t.color)};color:${escapeHtml(t.color)}"></span>${escapeHtml(t.emoji || '')} ${escapeHtml(t.name)}</div>`)
		.join('');
}

export function fitAllMarkers() {
	if (!map || markersById.size === 0) return;
	const bounds = L.latLngBounds([...markersById.values()].map((m) => m.getLatLng()));
	map.flyToBounds(bounds.pad(0.2), { duration: 1.2, maxZoom: 10 });
}

export function flyToMemory(id) {
	const marker = markersById.get(id);
	if (!marker || !map) return;
	map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 8), { duration: 1.1 });
	map.once('moveend', () => marker.openPopup());
}

/* ---------- geocoding (OpenStreetMap Nominatim, no key needed) ---------- */

export async function geocode(query) {
	const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=en&q=${encodeURIComponent(query)}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error('Geocoding failed');
	const rows = await res.json();
	return rows.map((r) => ({
		name: r.name || r.display_name.split(',')[0],
		full: r.display_name,
		lat: parseFloat(r.lat),
		lng: parseFloat(r.lon),
	}));
}

export async function reverseGeocode(lat, lng) {
	try {
		const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=en&lat=${lat}&lon=${lng}`;
		const res = await fetch(url);
		if (!res.ok) return null;
		const r = await res.json();
		return r.name || (r.display_name || '').split(',').slice(0, 2).join(',') || null;
	} catch {
		return null;
	}
}
