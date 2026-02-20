# Wildlands Critter Clash — Itch Release Notes

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:8000`.

## Itch embed (recommended)

* Recommended iframe size: **960×540** minimum, or a larger multiple (e.g. 1920×1080).
* Add `?itch=1` to enable embed-tuned UI defaults when not running in an iframe.

## Scaling behavior

* Internal render resolution is **960×540** (fixed).
* The canvas is CSS-scaled to the **largest integer scale** that fits the available viewport.
* If the viewport is smaller than 1×, the game stays at **1×** (pixel-perfect) by default.
  * You can allow a non-integer fallback fit via Settings: **“Allow non-integer fit when too small (<1×)”**.

## Fullscreen

Use the **Fullscreen** button in the top bar.

* In iframes, fullscreen may be blocked by browser/embed settings.
* If blocked, the game shows a small non-blocking toast message.

## Minimal chrome (itch-focused)

* Query param: `?minimal=1`
* Or toggle in Settings: **Minimal chrome**

This hides the top bar + footer to maximize play area.

## Rebuild runtime / Bible import

* `npm run build:runtime` regenerates `/runtime/*` deterministically.
* `npm run build` will **skip** Bible import if the XLSX is missing and runtime already exists.
  * Place the XLSX at project root named:
    `Wildlands_Data_Bible_v15_newbuild_phase2_full_extraction.xlsx`
  * To force import (and fail if missing), run:

```bash
npm run bible:import:force
```

## Bundle-only itch release folder

```bash
npm run release
```

Outputs `/release/` containing only what itch needs:

* `index.html`, `style.css`, `game_bundle.js`, `data_bundle.js`
* `runtime/*`
* `assets/*`
* `RELEASE_NOTES.md`
