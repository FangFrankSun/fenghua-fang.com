/* ============================================================
   timeline.js — timeline view, gallery view, lightbox.
   ============================================================ */

import { escapeHtml, formatDate, getTag, resolvePhotoURL } from './store.js';

const SVG_PIN = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

/* small display sizes load the thumb; the lightbox loads the full photo */
const thumbURL = (p) => resolvePhotoURL(p.thumb ? { src: p.thumb } : p);
const SVG_PENCIL = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

let revealObserver = null;

function observeReveals(root) {
	if (!revealObserver) {
		revealObserver = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (e.isIntersecting) {
					e.target.classList.add('is-in');
					revealObserver.unobserve(e.target);
				}
			}
		}, { threshold: 0.12 });
	}
	root.querySelectorAll('.reveal').forEach((el) => {
		const r = el.getBoundingClientRect();
		if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in');
		else revealObserver.observe(el);
	});
}

function tagChipsHtml(tagIds) {
	return (tagIds || [])
		.map((id) => getTag(id))
		.filter(Boolean)
		.map((t) => `<span class="tag-chip" style="--chip-color:${escapeHtml(t.color)}">${escapeHtml(t.emoji || '')} ${escapeHtml(t.name)}</span>`)
		.join('');
}

/* ---------- memory card ---------- */

function buildCard(mem, { editMode, onEdit, onShowOnMap, onOpenPhoto }) {
	const card = document.createElement('article');
	card.className = 'mem-card';
	const firstTag = getTag((mem.tags || [])[0]);
	if (firstTag) card.style.setProperty('--dot-color', firstTag.color);

	const photos = mem.photos || [];
	let idx = 0;

	const media = document.createElement('div');
	media.className = 'mem-media';

	if (photos.length === 0) {
		media.innerHTML = `<div class="mem-empty">♥︎</div>`;
	} else {
		const img = document.createElement('img');
		img.alt = mem.title || '';
		img.loading = 'lazy';
		thumbURL(photos[0]).then((u) => { if (u) img.src = u; });
		img.addEventListener('click', () => onOpenPhoto(mem, idx));
		media.appendChild(img);

		if (photos.length > 1) {
			const show = (next) => {
				idx = (next + photos.length) % photos.length;
				thumbURL(photos[idx]).then((u) => { if (u) img.src = u; });
				count.textContent = `${idx + 1}/${photos.length}`;
			};
			const prev = document.createElement('button');
			prev.className = 'ph-nav ph-prev';
			prev.innerHTML = '‹';
			prev.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1); });
			const next = document.createElement('button');
			next.className = 'ph-nav ph-next';
			next.innerHTML = '›';
			next.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1); });
			const count = document.createElement('span');
			count.className = 'ph-count';
			count.textContent = `1/${photos.length}`;
			media.append(prev, next, count);
		}
	}
	card.appendChild(media);

	if (editMode) {
		const edit = document.createElement('button');
		edit.className = 'mem-edit';
		edit.title = 'Edit this memory';
		edit.innerHTML = SVG_PENCIL;
		edit.addEventListener('click', () => onEdit(mem.id));
		card.appendChild(edit);
	}

	const body = document.createElement('div');
	body.className = 'mem-body';
	body.innerHTML = `
		<span class="mem-date">${escapeHtml(formatDate(mem.date))}${mem.time ? ' · ' + escapeHtml(mem.time) : ''}</span>
		<h3 class="mem-title">${escapeHtml(mem.title || 'Untitled')}</h3>
		${mem.description ? `<p class="mem-desc">${escapeHtml(mem.description)}</p>` : ''}
	`;
	if (mem.place && Number.isFinite(mem.place.lat)) {
		const placeBtn = document.createElement('button');
		placeBtn.className = 'mem-place';
		placeBtn.innerHTML = `${SVG_PIN} ${escapeHtml(mem.place.name || 'On the map')}`;
		placeBtn.addEventListener('click', () => onShowOnMap(mem.id));
		body.appendChild(placeBtn);
	}
	const tags = document.createElement('div');
	tags.className = 'mem-tags';
	tags.innerHTML = tagChipsHtml(mem.tags);
	body.appendChild(tags);
	card.appendChild(body);

	return card;
}

/* ---------- timeline ---------- */

export function renderTimeline(container, memories, opts) {
	container.innerHTML = '';
	if (!memories.length) {
		container.innerHTML = `<p class="timeline-empty">No memories here yet… unlock edit mode and add our first one ♥︎</p>`;
		return;
	}
	let lastYear = null;
	let side = 0;
	for (const mem of memories) {
		const year = (mem.date || '').slice(0, 4) || '····';
		if (year !== lastYear) {
			lastYear = year;
			const y = document.createElement('div');
			y.className = 'tl-year reveal';
			y.textContent = year;
			container.appendChild(y);
		}
		const item = document.createElement('div');
		item.className = 'tl-item ' + (side++ % 2 ? 'tl-right' : 'tl-left');
		item.dataset.memId = mem.id;

		const dot = document.createElement('span');
		dot.className = 'tl-dot';
		const firstTag = getTag((mem.tags || [])[0]);
		if (firstTag) dot.style.setProperty('--dot-color', firstTag.color);

		const cardWrap = document.createElement('div');
		cardWrap.className = 'tl-card reveal';
		cardWrap.appendChild(buildCard(mem, opts));

		item.append(dot, cardWrap);
		container.appendChild(item);
	}
	observeReveals(container);
}

/* ---------- gallery ---------- */

export function renderGallery(container, memories, { onOpenPhoto }) {
	container.innerHTML = '';
	const items = [];
	for (const mem of memories) {
		(mem.photos || []).forEach((p, i) => items.push({ mem, photo: p, photoIndex: i }));
	}
	if (!items.length) {
		container.innerHTML = `<p class="gallery-empty">No photos yet — our gallery is waiting</p>`;
		return;
	}
	for (const { mem, photo, photoIndex } of items) {
		const fig = document.createElement('figure');
		fig.className = 'g-item reveal';
		fig.style.margin = '0 0 14px';
		const img = document.createElement('img');
		img.alt = mem.title || '';
		img.loading = 'lazy';
		thumbURL(photo).then((u) => { if (u) img.src = u; });
		const cap = document.createElement('figcaption');
		cap.className = 'g-cap';
		cap.innerHTML = `<small>${escapeHtml(formatDate(mem.date))}</small>${escapeHtml(mem.title || '')}`;
		fig.append(img, cap);
		fig.addEventListener('click', () => onOpenPhoto(mem, photoIndex));
		container.appendChild(fig);
	}
	observeReveals(container);
}

/* ---------- lightbox ---------- */

const lb = {
	el: null, img: null, caption: null,
	items: [], idx: 0,
};

export function initLightbox() {
	lb.el = document.getElementById('lightbox');
	lb.img = document.getElementById('lb-img');
	lb.caption = document.getElementById('lb-caption');
	document.getElementById('lb-close').addEventListener('click', closeLightbox);
	document.getElementById('lb-prev').addEventListener('click', () => stepLightbox(-1));
	document.getElementById('lb-next').addEventListener('click', () => stepLightbox(1));
	lb.el.addEventListener('click', (e) => { if (e.target === lb.el) closeLightbox(); });
	document.addEventListener('keydown', (e) => {
		if (lb.el.hidden) return;
		if (e.key === 'Escape') closeLightbox();
		if (e.key === 'ArrowLeft') stepLightbox(-1);
		if (e.key === 'ArrowRight') stepLightbox(1);
	});
}

export async function openLightboxForMemory(mem, startIndex = 0) {
	const items = [];
	for (const p of mem.photos || []) {
		const url = await resolvePhotoURL(p);
		if (!url) continue;
		const when = formatDate(p.date || mem.date) + (p.time ? ` · ${p.time}` : '');
		items.push({ url, caption: `${when} — ${mem.title || ''}` });
	}
	if (!items.length) return;
	lb.items = items;
	lb.idx = Math.min(startIndex, items.length - 1);
	showLightbox();
}

function showLightbox() {
	const item = lb.items[lb.idx];
	lb.img.src = item.url;
	lb.caption.textContent = item.caption;
	const multi = lb.items.length > 1;
	document.getElementById('lb-prev').style.display = multi ? '' : 'none';
	document.getElementById('lb-next').style.display = multi ? '' : 'none';
	lb.el.hidden = false;
	document.body.style.overflow = 'hidden';
}

function stepLightbox(d) {
	lb.idx = (lb.idx + d + lb.items.length) % lb.items.length;
	showLightbox();
}

function closeLightbox() {
	lb.el.hidden = true;
	lb.img.src = '';
	document.body.style.overflow = '';
}
