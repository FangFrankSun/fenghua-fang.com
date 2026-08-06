# Fenghua & Fang — Our Story 💗

The interactive home of our memories: a **timeline**, a **world map**, and a **gallery**,
live at [love.fenghua-fang.com](https://love.fenghua-fang.com). Runs entirely on GitHub Pages —
no server, no accounts, no build step.

## The three views

- **Timeline** — every memory in order, grouped by year, with photos, notes, places, and colored tags.
- **Map** — an interactive world map. Every memory with a place gets a pin, colored by its tag. Click a pin for the photo and story.
- **Gallery** — all our photos in one wall.

## Editing (for the two of us)

1. Tap **Edit** in the top-right and enter our little secret code. (It is written nowhere — that's the point.)
2. An edit toolbar appears. You can now:
   - **＋ New memory** — title, date, note, tags, place, photos.
   - Tap the ✏️ on any card or map popup to edit or delete it.
   - **🏷️ Tags** — rename tags, change their colors and emoji, add new ones. Pins and chips recolor everywhere.
3. **Photos**: drag & drop or browse, as many as you like. They are compressed automatically in the browser.
4. **Places**: type any address or place name (free OpenStreetMap search), then fine-tune the pin on the mini-map.

Edits save instantly **on your own device** (browser storage). To make them permanent and visible to both of us:

## Publishing & syncing between us

1. In edit mode press **⬇ Export** — it downloads a fresh `memories.json` with your new photos embedded.
2. Replace `data/memories.json` in this repo with it (GitHub web upload works fine) and commit.
3. Done — the site now shows it to everyone, on every device. After publishing you can press **↺ Reset local** to drop the local copy and read from the published version again.

To pull in each other's unpublished edits directly: send the exported file and use **⬆ Import** —
it merges by memory, newest edit wins.

## Phone / app

The site is a PWA: open it on a phone, choose **Add to Home Screen**, and it installs like an app
(icon, full-screen, offline shell). This is also the stepping stone for a future iOS/Android build —
the data model (`data/memories.json`) is app-ready as is.

## Keepsakes

The older pages still live here: `legacy.html` (the first website), `Christmas.html`,
`Christmas-line.html`, `stars.html` — linked from the footer.

## Development

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Structure: `index.html` (shell) · `app/` (styles + ES modules: store, timeline, map, editor, main) ·
`data/memories.json` (the published story) · `sw.js` + `manifest.webmanifest` (PWA).
Map tiles by [CARTO](https://carto.com/attributions) / [OpenStreetMap](https://www.openstreetmap.org/copyright); maps by [Leaflet](https://leafletjs.com).
