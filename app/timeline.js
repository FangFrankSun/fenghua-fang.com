/* ============================================================
   timeline.js — serpentine timeline view, gallery view, lightbox.

   The timeline is one winding road through our story: it flows
   right, curves down at the edge, flows left, curves down again…
   As the page opens (and as you scroll) the line travels forward,
   and every memory sprouts from its dot when the line reaches it.
   ============================================================ */

import { escapeHtml, formatDate, getTag, resolvePhotoURL } from './store.js';

const SVG_PIN = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
const SVG_PENCIL = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

/* small display sizes load the thumb; the lightbox loads the full photo */
const thumbURL = (p) => resolvePhotoURL(p.thumb ? { src: p.thumb } : p);

/* set an image source with one automatic retry — covers flaky mobile
   networks and CDN propagation right after a deploy */
export function setImgSrc(img, url) {
	if (!url) return;
	let retried = false;
	img.onerror = () => {
		if (retried) return;
		retried = true;
		setTimeout(() => { img.src = url + (url.includes('?') ? '&' : '?') + 'r=1'; }, 1500);
	};
	img.src = url;
}

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
	root.querySelectorAll('.reveal:not(.is-in):not([data-obs])').forEach((el) => {
		el.dataset.obs = '1';
		const r = el.getBoundingClientRect();
		if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in');
		else revealObserver.observe(el);
	});
}

/* ============================================================
   Serpentine timeline
   ============================================================ */

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

const sp = {
	container: null,
	memories: [],
	opts: null,
	sig: '',            // identity of the rendered list — same sig ⇒ keep progress
	preserve: 0,        // nodes to re-grow instantly after a rebuild
	pendingBuild: false,
	pendingEnsure: null,
	builtW: 0,
	builtH: 0,
	geo: null,
	rowMeta: null,
	nodes: [],          // [{ len, mem, parts }] sorted by length along the road
	grownIdx: 0,
	progress: 0,
	totalLen: 0,
	progEl: null,
	tipEl: null,
	contBtn: null,
	parkKey: -1,
	imgObserver: null,
	loopOn: false,
	lastT: 0,
};

export function renderTimeline(container, memories, opts) {
	const sig = memories.map((m) => m.id).join('|');
	sp.preserve = sig === sp.sig ? sp.grownIdx : 0;
	sp.sig = sig;
	sp.container = container;
	sp.memories = memories;
	sp.opts = opts;
	sp.pendingBuild = true;
	if (!sp.loopOn) {
		sp.loopOn = true;
		requestAnimationFrame(spLoop);
	}
}

/* jump the road instantly past a memory (map → timeline navigation) */
export function ensureMemoryRendered(id) {
	if (sp.pendingBuild) { sp.pendingEnsure = id; return; }
	spEnsure(id);
}

function spEnsure(id) {
	const node = sp.nodes.find((n) => n.mem && n.mem.id === id);
	if (!node) return;
	if (node.len >= sp.progress) {
		sp.progress = Math.min(sp.totalLen, node.len + 1);
		spGrowTo(sp.progress, true);
		spPaint();
	}
}

/* ---------- geometry ---------- */

function spLayout(w, count, availH) {
	const edge = w < 640 ? 12 : 18;          // road inset from the page sides
	const turnR = w < 640 ? 22 : 36;         // corner radius of each U-turn
	const zone0 = edge + turnR + 8;          // cards live between the turns
	const zone1 = w - edge - turnR - 8;
	const zoneW = zone1 - zone0;
	const cols = zoneW >= 1000 ? 4 : zoneW >= 660 ? 3 : 2;
	const slotW = zoneW / cols;
	const cardW = Math.floor(slotW - (cols === 2 ? 12 : 22));
	const showDesc = cols >= 3;
	const textH = showDesc ? 112 : 78;
	const stemH = 18;                        // stalk between card and its dot
	const below = 34;                        // room under each road line (year pills)
	const top = 4;
	/* photo height adapts to the screen so the first TWO rows always fit
	   fully on open, on any laptop — clamped so photos never get absurd */
	const maxImg = Math.round(cardW * (cols === 2 ? 0.72 : 0.68));
	const minImg = Math.max(96, Math.round(cardW * 0.42));
	const fitImg = Math.floor((availH - top - below - 34) / 2) - stemH - textH;
	const imgH = Math.max(minImg, Math.min(maxImg, fitImg));
	const cardH = imgH + textH;
	const pitch = cardH + stemH + below;     // distance between consecutive lines
	const rows = Math.max(1, Math.ceil(count / cols));
	const lineY = (r) => top + r * pitch + cardH + stemH;
	return {
		w, edge, turnR, zone0, zone1, cols, slotW, cardW, cardH, imgH,
		stemH, pitch, rows, lineY, height: top + rows * pitch + 80,
	};
}

function spBuildPath(g, count, nodeXs) {
	const { edge, turnR: r, w, rows, lineY, } = g;
	const xL = edge + r, xR = w - edge - r;
	let d = '', len = 0;
	const rowMeta = [];
	let endX = 0, endY = 0, endLtr = true;
	for (let row = 0; row < rows; row++) {
		const y = lineY(row);
		const ltr = row % 2 === 0;
		const x0 = row === 0 ? edge : ltr ? xL : xR;
		const last = row === rows - 1;
		let x1;
		if (last) {
			// the road ends a little past the final memory
			const lastNodeX = nodeXs[count - 1];
			x1 = ltr ? Math.min(xR, lastNodeX + 52) : Math.max(xL, lastNodeX - 52);
			endX = x1; endY = y; endLtr = ltr;
		} else {
			x1 = ltr ? xR : xL;
		}
		if (row === 0) d += `M ${x0} ${y} `;
		d += `L ${x1} ${y} `;
		const meta = { y, len0: len, x0, hLen: Math.abs(x1 - x0), turnLen: 0 };
		len += meta.hLen;
		if (!last) {
			const yn = lineY(row + 1);
			const sweep = ltr ? 1 : 0;
			const xo = ltr ? x1 + r : x1 - r;
			d += `A ${r} ${r} 0 0 ${sweep} ${xo} ${y + r} L ${xo} ${yn - r} A ${r} ${r} 0 0 ${sweep} ${x1} ${yn} `;
			meta.turnLen = Math.PI * r + (yn - y - 2 * r);
			len += meta.turnLen;
		}
		rowMeta.push(meta);
	}
	const sx = endLtr ? endX + 58 : endX - 58;
	return {
		d,
		stubD: `M ${endX} ${endY} L ${sx} ${endY}`,
		rowMeta, totalLen: len, endX, endY, endLtr,
	};
}

/* ---------- build ---------- */

function spBuild(w) {
	const c = sp.container;
	sp.pendingBuild = false;
	sp.builtW = w;
	sp.imgObserver?.disconnect();
	sp.nodes = [];
	sp.grownIdx = 0;
	sp.progress = 0;
	sp.totalLen = 0;
	sp.progEl = null;
	sp.tipEl = null;
	sp.contBtn = null;
	sp.parkKey = -1;
	c.classList.remove('sp-cols-2');
	c.innerHTML = '';
	c.style.height = '';

	const memories = sp.memories;
	if (!memories.length) {
		sp.geo = null;
		sp.rowMeta = null;
		c.innerHTML = `<p class="timeline-empty">No memories here yet… unlock edit mode and add our first one ♥︎</p>`;
		return;
	}

	const tlTop = c.getBoundingClientRect().top + scrollY;
	sp.builtH = innerHeight;
	const g = spLayout(w, memories.length, innerHeight - tlTop);
	sp.geo = g;
	if (g.cols === 2) c.classList.add('sp-cols-2');
	c.style.height = g.height + 'px';

	const nodeXs = memories.map((_, i) => {
		const row = Math.floor(i / g.cols);
		const col = i % g.cols;
		return row % 2 === 0
			? g.zone0 + (col + 0.5) * g.slotW
			: g.zone1 - (col + 0.5) * g.slotW;
	});

	const path = spBuildPath(g, memories.length, nodeXs);
	sp.rowMeta = path.rowMeta;
	sp.totalLen = path.totalLen;

	/* the road — faint track for the way ahead, vivid line for the way travelled */
	const NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('class', 'sp-svg');
	svg.setAttribute('width', w);
	svg.setAttribute('height', g.height);
	svg.setAttribute('viewBox', `0 0 ${w} ${g.height}`);
	svg.setAttribute('aria-hidden', 'true');

	const defs = document.createElementNS(NS, 'defs');
	const grad = document.createElementNS(NS, 'linearGradient');
	grad.setAttribute('id', 'sp-grad');
	grad.setAttribute('gradientUnits', 'userSpaceOnUse');
	grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
	grad.setAttribute('x2', '0'); grad.setAttribute('y2', String(g.height));
	const COLORS = ['#dd8a9c', '#d9a05b', '#b39ddb']; // rose → gold → lavender
	const stops = Math.max(3, Math.min(13, g.rows + 1));
	for (let i = 0; i < stops; i++) {
		const s = document.createElementNS(NS, 'stop');
		s.setAttribute('offset', (i / (stops - 1)).toFixed(3));
		s.setAttribute('stop-color', COLORS[i % COLORS.length]);
		grad.appendChild(s);
	}
	defs.appendChild(grad);
	svg.appendChild(defs);

	const track = document.createElementNS(NS, 'path');
	track.setAttribute('class', 'sp-track');
	track.setAttribute('d', path.d);
	const stub = document.createElementNS(NS, 'path');
	stub.setAttribute('class', 'sp-stub');
	stub.setAttribute('d', path.stubD);
	const prog = document.createElementNS(NS, 'path');
	prog.setAttribute('class', 'sp-progress');
	prog.setAttribute('d', path.d);
	prog.style.strokeDasharray = `${path.totalLen} ${path.totalLen}`;
	prog.style.strokeDashoffset = String(path.totalLen);
	svg.append(track, stub, prog);
	c.appendChild(svg);
	sp.progEl = prog;

	/* load images when their (untransformed) slot nears the viewport —
	   the card itself is scaled to 0 until it grows, so lazy-loading
	   keys off the wrapper, which always keeps its real size */
	sp.imgObserver = new IntersectionObserver((entries) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			sp.imgObserver.unobserve(e.target);
			if (e.target._loadImg) { e.target._loadImg(); e.target._loadImg = null; }
		}
	}, { rootMargin: '900px 0px' });

	const frag = document.createDocumentFragment();
	let lastYear = null;
	memories.forEach((mem, i) => {
		const row = Math.floor(i / g.cols);
		const meta = path.rowMeta[row];
		const x = nodeXs[i];
		const y = g.lineY(row);
		const parts = [];
		const firstTag = getTag((mem.tags || [])[0]);

		const stem = document.createElement('span');
		stem.className = 'sp-stem';
		stem.style.left = (x - 1.5) + 'px';
		stem.style.top = (y - g.stemH) + 'px';
		stem.style.height = g.stemH + 'px';
		if (firstTag) stem.style.setProperty('--dot-color', firstTag.color);
		parts.push(stem);

		const dot = document.createElement('span');
		dot.className = 'sp-dot';
		dot.style.left = (x - 8.5) + 'px';
		dot.style.top = (y - 8.5) + 'px';
		if (firstTag) dot.style.setProperty('--dot-color', firstTag.color);
		parts.push(dot);

		const year = (mem.date || '').slice(0, 4) || '····';
		if (year !== lastYear) {
			lastYear = year;
			const pill = document.createElement('span');
			pill.className = 'sp-year';
			pill.textContent = year;
			pill.style.left = x + 'px';
			pill.style.top = (y + 9) + 'px';
			parts.push(pill);
			frag.appendChild(pill);
		}

		const wrap = document.createElement('div');
		wrap.className = 'sp-node';
		wrap.dataset.memId = mem.id;
		wrap.style.left = (x - g.cardW / 2) + 'px';
		wrap.style.top = (y - g.stemH - g.cardH) + 'px';
		wrap.style.width = g.cardW + 'px';
		wrap.style.height = g.cardH + 'px';
		const grow = document.createElement('div');
		grow.className = 'sp-grow';
		grow.style.transformOrigin = `50% calc(100% + ${g.stemH + 6}px)`;
		grow.appendChild(buildCompactCard(mem, g, sp.opts, wrap));
		wrap.appendChild(grow);
		parts.push(grow);

		frag.append(wrap, stem, dot);
		sp.imgObserver.observe(wrap);
		sp.nodes.push({ len: meta.len0 + Math.abs(x - meta.x0), mem, parts });
	});

	/* the road goes on — dashed stub + a promise */
	const tbc = document.createElement('span');
	tbc.className = 'sp-tbc';
	tbc.textContent = 'to be continued ♥︎';
	tbc.style.left = (path.endLtr ? path.endX + 29 : path.endX - 29) + 'px';
	tbc.style.top = (path.endY + 14) + 'px';
	frag.appendChild(tbc);
	sp.nodes.push({ len: sp.totalLen - 0.5, mem: null, parts: [tbc] });

	/* the little heart travelling at the head of the line */
	const tip = document.createElement('div');
	tip.className = 'sp-tip';
	tip.innerHTML = '<span>♥&#xFE0E;</span>';
	frag.appendChild(tip);
	sp.tipEl = tip;

	/* "continue" pill shown wherever the road parks */
	const cont = document.createElement('button');
	cont.className = 'sp-continue';
	cont.type = 'button';
	cont.innerHTML = 'continue <span aria-hidden="true">♥&#xFE0E;</span>';
	cont.addEventListener('click', spContinueClick);
	frag.appendChild(cont);
	sp.contBtn = cont;
	sp.parkKey = -1;

	c.appendChild(frag);

	/* after a rebuild (resize / edit toggle) re-grow what was already there */
	const keep = Math.min(sp.preserve, sp.nodes.length);
	sp.preserve = 0;
	if (keep > 0) {
		sp.progress = Math.min(sp.totalLen, sp.nodes[keep - 1].len + 1);
		spGrowTo(sp.progress, true);
	}
	spPaint();

	if (sp.pendingEnsure) {
		const id = sp.pendingEnsure;
		sp.pendingEnsure = null;
		spEnsure(id);
	}
}

/* ---------- compact memory card (the sprout) ---------- */

function buildCompactCard(mem, g, opts, wrap) {
	const { editMode, onEdit, onShowOnMap, onOpenPhoto } = opts;
	const card = document.createElement('article');
	card.className = 'mem-card mem-card--sp';
	const firstTag = getTag((mem.tags || [])[0]);
	if (firstTag) card.style.setProperty('--dot-color', firstTag.color);

	const photos = mem.photos || [];
	const media = document.createElement('div');
	media.className = 'mem-media';
	media.style.height = g.imgH + 'px';
	if (!photos.length) {
		media.innerHTML = `<div class="mem-empty">♥︎</div>`;
	} else {
		const img = document.createElement('img');
		img.alt = mem.title || '';
		img.decoding = 'async';
		wrap._loadImg = () => thumbURL(photos[0]).then((u) => setImgSrc(img, u));
		img.addEventListener('click', () => onOpenPhoto(mem, 0));
		media.appendChild(img);
		if (photos.length > 1) {
			const count = document.createElement('span');
			count.className = 'ph-count';
			count.textContent = `+${photos.length - 1}`;
			media.appendChild(count);
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
		<h3 class="mem-title" title="${escapeHtml(mem.title || '')}">${escapeHtml(mem.title || 'Untitled')}</h3>
		${mem.description ? `<p class="mem-desc">${escapeHtml(mem.description)}</p>` : ''}
	`;
	if (mem.place && Number.isFinite(mem.place.lat)) {
		const placeBtn = document.createElement('button');
		placeBtn.className = 'mem-place';
		placeBtn.innerHTML = `${SVG_PIN} <span class="mem-place-name">${escapeHtml(mem.place.name || 'On the map')}</span>`;
		placeBtn.addEventListener('click', () => onShowOnMap(mem.id));
		body.appendChild(placeBtn);
	}
	card.appendChild(body);
	return card;
}

/* ---------- travel ---------- */

function spGrowTo(len, instant) {
	while (sp.grownIdx < sp.nodes.length && sp.nodes[sp.grownIdx].len <= len) {
		const node = sp.nodes[sp.grownIdx++];
		for (const el of node.parts) {
			if (instant) el.classList.add('sp-instant');
			el.classList.add('is-grown');
		}
	}
}

function spPaint() {
	if (!sp.progEl) return;
	sp.progEl.style.strokeDashoffset = String(Math.max(0, sp.totalLen - sp.progress));
	if (!sp.tipEl) return;
	if (sp.progress > 1) {
		const pt = sp.progEl.getPointAtLength(Math.min(sp.progress, sp.totalLen));
		sp.tipEl.style.transform = `translate3d(${pt.x}px, ${pt.y}px, 0)`;
		sp.tipEl.classList.add('is-on');
	} else {
		sp.tipEl.classList.remove('is-on');
	}
}

/* how far along the road should the line be, given the scroll position?
   a row only wakes once the WHOLE row (cards + its line) is on screen,
   so a sprouting card is never clipped by the bottom of the viewport */
function spTarget() {
	const meta = sp.rowMeta;
	if (!meta) return { len: 0, row: -1 };
	const rect = sp.container.getBoundingClientRect();
	const front = innerHeight - rect.top; // viewport bottom, container coords
	let len = 0, row = -1;
	for (let r = 0; r < meta.length; r++) {
		const m = meta[r];
		if (front < m.y + 26) break;
		row = r;
		len = m.len0 + m.hLen; // the U-turn is swept as part of entering the next row
	}
	if (row === meta.length - 1 && front > meta[row].y + 40) len = sp.totalLen;
	return { len: Math.min(len, sp.totalLen), row };
}

/* the pulsing "continue ♥" pill where the road is parked — clicking it
   scrolls the next row fully into view, and the line rolls on by itself */
function spUpdateContinue(target, parkRow) {
	const btn = sp.contBtn;
	if (!btn) return;
	const parked = parkRow >= 0
		&& target < sp.totalLen - 1
		&& Math.abs(sp.progress - target) < 1;
	if (!parked) { btn.classList.remove('is-on'); return; }
	if (sp.parkKey !== parkRow) {
		sp.parkKey = parkRow;
		const m = sp.rowMeta[parkRow];
		const ltr = parkRow % 2 === 0;
		const xEnd = ltr ? m.x0 + m.hLen : m.x0 - m.hLen;
		btn.style.left = (xEnd + (ltr ? -4 : 4)) + 'px';
		btn.style.top = (m.y + 14) + 'px';
		btn.classList.toggle('sp-cont-rtl', !ltr);
	}
	btn.classList.add('is-on');
}

function spContinueClick() {
	const meta = sp.rowMeta;
	if (!meta || sp.parkKey < 0) return;
	const next = sp.parkKey + 1;
	// reveal the next row (or, past the last one, the road's very end)
	const frontWanted = next < meta.length
		? meta[next].y + 64
		: meta[meta.length - 1].y + 120;
	const rect = sp.container.getBoundingClientRect();
	sp.contBtn.classList.remove('is-on');
	scrollTo({
		top: rect.top + scrollY + frontWanted - innerHeight,
		behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth',
	});
}

function spLoop(t) {
	const c = sp.container;
	if (!c || !c.isConnected) { sp.loopOn = false; return; }
	const w = c.clientWidth;
	if (w === 0) { // view is hidden — nap until it's back
		sp.lastT = 0;
		setTimeout(() => requestAnimationFrame(spLoop), 260);
		return;
	}
	if (sp.pendingBuild || w !== sp.builtW || Math.abs(innerHeight - sp.builtH) > 120) {
		if (!sp.pendingBuild) sp.preserve = sp.grownIdx; // resize keeps progress
		spBuild(w);
	}
	if (sp.nodes.length) {
		const dt = sp.lastT ? Math.min(0.06, (t - sp.lastT) / 1000) : 0.016;
		sp.lastT = t;
		const { len: target, row } = spTarget();
		if (target > sp.progress) {
			if (REDUCED_MOTION.matches) {
				sp.progress = target;
				spGrowTo(sp.progress, true);
			} else {
				// travel: cruise while reading, sweep when far behind
				const dist = target - sp.progress;
				const speed = Math.min(Math.max(950, dist * 2.4), 12000);
				sp.progress = Math.min(target, sp.progress + speed * dt);
				spGrowTo(sp.progress, false);
			}
			spPaint();
		}
		spUpdateContinue(target, row);
	}
	requestAnimationFrame(spLoop);
}

/* ---------- gallery ---------- */

/* Stable masonry: fixed JS-managed columns. Every image declares its
   aspect ratio up front, and each new photo goes to the shortest column —
   photos that are already placed NEVER move, even while loading. */
let galleryResizeWired = false;
let galleryArgs = null;

export function renderGallery(container, memories, callbacks, initialCount = 16) {
	container.innerHTML = '';
	document.getElementById('g-loadmore')?.remove();
	galleryArgs = { container, memories, callbacks };

	const { onOpenPhoto } = callbacks;
	const items = [];
	for (const mem of memories) {
		(mem.photos || []).forEach((p, i) => items.push({ mem, photo: p, photoIndex: i }));
	}
	if (!items.length) {
		container.innerHTML = `<p class="gallery-empty">No photos yet — our gallery is waiting</p>`;
		return;
	}

	const width = container.clientWidth || innerWidth;
	const colCount = Math.max(2, Math.min(4, Math.floor(width / 260)));
	const cols = [], heights = [];
	for (let c = 0; c < colCount; c++) {
		const col = document.createElement('div');
		col.className = 'g-col';
		container.appendChild(col);
		cols.push(col);
		heights.push(0);
	}

	const MORE = 24;
	let i = 0;

	const btn = document.createElement('button');
	btn.id = 'g-loadmore';
	btn.className = 'btn btn-primary g-loadmore';
	container.parentElement.appendChild(btn);

	const step = (n) => {
		const end = Math.min(i + n, items.length);
		for (; i < end; i++) {
			const { mem, photo, photoIndex } = items[i];
			const w = photo.w || 4, h = photo.h || 3;

			const fig = document.createElement('figure');
			fig.className = 'g-item reveal';
			fig.style.margin = '0';
			const img = document.createElement('img');
			img.alt = mem.title || '';
			img.loading = 'lazy';
			img.decoding = 'async';
			img.style.aspectRatio = `${w} / ${h}`; // exact space reserved before load
			thumbURL(photo).then((u) => setImgSrc(img, u));
			const cap = document.createElement('figcaption');
			cap.className = 'g-cap';
			cap.innerHTML = `<small>${escapeHtml(formatDate(photo.date || mem.date))}</small>${escapeHtml(mem.title || '')}`;
			fig.append(img, cap);
			fig.addEventListener('click', () => onOpenPhoto(mem, photoIndex));

			let ci = 0;
			for (let c = 1; c < colCount; c++) if (heights[c] < heights[ci]) ci = c;
			heights[ci] += h / w;
			cols[ci].appendChild(fig);
		}
		observeReveals(container);
		const left = items.length - i;
		if (left <= 0) btn.remove();
		else btn.textContent = `Load more ♥︎ ${left} photos left`;
	};

	btn.addEventListener('click', () => step(MORE));
	step(initialCount);

	if (!galleryResizeWired) {
		galleryResizeWired = true;
		let lastW = innerWidth, timer = null;
		addEventListener('resize', () => {
			if (innerWidth === lastW || !galleryArgs) return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				lastW = innerWidth;
				const a = galleryArgs;
				renderGallery(a.container, a.memories, a.callbacks, Math.max(16, i));
			}, 300);
		});
	}
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
		const desc = mem.description ? ` — ${mem.description}` : '';
		items.push({ url, caption: `${when} — ${mem.title || ''}${desc}` });
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
