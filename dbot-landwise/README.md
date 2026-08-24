# DBOT Land Intelligence

Standalone product — own codebase, not integrated with Map Studio. Map +
search + Location & Land Details panel, matching the reference layout,
built on DBOT's own navy/gold styling.

## Architecture

This app **never calls MCGM directly**. It reads the GeoJSON files already
produced by `dbot-dp-engine`'s bulk-download scripts (`bulkDownloadAll.js`,
`downloadAllParcels.js`). That project stays the periodic data-refresh job;
this one just serves what's already on disk, fast, entirely in memory.

```
dbot-dp-engine (separate project)          dbot-landwise (this project)
  bulkDownloadAll.js      ───┐
  downloadAllParcels.js   ───┼──► data/layers/*.geojson  ───► loaded once
                              └──► data/parcels/*.geojson       at startup
```

## Setup

1. Point `data/layers` and `data/parcels` at dbot-dp-engine's output —
   either copy the folders over, or set env vars to read them in place:
   ```bash
   set DP_LAYERS_DIR=D:\path\to\dbot-dp-engine\data\layers
   set DP_PARCELS_DIR=D:\path\to\dbot-dp-engine\data\parcels
   ```
   (Windows `set`, or `export` on macOS/Linux. Without these, it defaults
   to `data/layers` and `data/parcels` relative to this project.)

2. Install and run:
   ```bash
   npm install
   npm start
   ```

3. Open `http://localhost:3000`.

## What's real vs. what's a placeholder right now

**Real, computed, verified:**
- Ward/Village/CTS search (reads directly from the downloaded parcel data)
- Click-to-select on the map, parcel highlight
- Zone / DP Zone / Island City classification (real spatial intersection
  against DP/0 and DP/74 — tested end-to-end against a live server before
  shipping, not just checked for syntax)
- Area (exact, geodesic, computed from the parcel polygon)

**Approximated, clearly labeled as such in the UI ("approx."):**
- Avg Width — no single standard definition for an irregular polygon;
  this uses area ÷ longest bounding-box axis, a reasonable estimate for
  roughly-rectangular plots, not an exact replication of any specific
  algorithm.

**Left blank on purpose, not guessed:**
- Avg Elevation — no confirmed data source (flagged as an open gap
  several turns back in the dbot-dp-engine work; a fabricated number here
  would be worse than an honest blank).
- Abutting Road, Ownership, Development Type — either not reliably
  derivable from GIS data alone, or inherently a human/legal judgment
  call, same as the reference screenshot treats them (editable fields,
  not auto-facts).

## Verified before shipping

Ran a real Express server against synthetic test data matching the exact
schema of the real dataset (same field names, same structure as
`dbot-dp-engine`'s output), then hit every endpoint with curl:
- `/api/wards`, `/api/villages`, `/api/parcels` — correct list results
- `/api/parcel/:ward/:village/:cts` — correct zone resolution via real
  spatial intersection, correct area calculation (cross-checked by hand:
  70,113.91 sq m for the test geometry), correct avg-width formula
  (222.14 — matches area ÷ longest axis computed independently)
- `/api/stats` — correct counts

## Next screen — not yet built

The reference material also showed an "Additional Land Details" panel
(ASR rates, CBD/CRZ/Gaothan/Metro toggles, reservation info) as the step
after this one. That's the natural next piece — the data for most of
those toggles is already sitting in the same `data/layers` files this
app already loads (DP_46 reservations, DP_66 CRZ, AKO_1022 gaothan,
DD_43 airport height, etc.) — it's a UI + wiring task, not a new data
problem.
