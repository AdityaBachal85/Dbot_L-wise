# dbot-dp-engine

MCGM Development Plan 2034 parcel fact-sheet fetcher. This is the GIS/data
layer for DBOT Land Intelligence — search a CTS parcel, fetch every
confirmed regulatory-fact layer that intersects it, get back a structured,
auditable JSON fact sheet.

This module deliberately does **not** compute FSI or scheme eligibility.
That belongs in a separate DCPR regulation engine that consumes this
module's output — keeps the "fetch facts" and "apply regulation" concerns
independently testable, and lets both Map Studio and ai.dbot.in call the
regulation engine without duplicating this fetching logic.

## Requirements

- Node.js 18+ (uses native `fetch`)
- **Real, unrestricted network access.** MCGM's servers are unauthenticated
  but gated by robots.txt for automated tools — this needs to run from your
  own machine or server, not a sandboxed environment.

## Quick start

```bash
npm install   # no dependencies to install yet — reserved for when this grows
node examples/fetchParcel.js
```

That reproduces the exact flow verified earlier in this project: look up
CTS 1/1061 in Bhuleshwar (Ward C), then fetch the full fact battery.
Output goes to `fact-sheet-output.json`.

## API

```js
import { listVillagesInWard, listParcelsInVillage, getParcelGeometry, buildFactSheet } from './src/index.js';

// Cascading search — mirrors the video's "Search CTS / village" flow
const villages = await listVillagesInWard('C');
const parcels = await listParcelsInVillage('C', 'BHULESHWAR');
const parcel = await getParcelGeometry('C', 'BHULESHWAR', '1/1061');

// Fact sheet — pass multiple geometries for a multi-select (auto-unions them)
const factSheet = await buildFactSheet([parcel.geometry]);
```

`factSheet.facts` is grouped by category (`zone`, `reservations`,
`designations`, `roads`, `heritage`, `crz`, `height`, `metro`, `gaothan`,
`admin`) — each entry says which layer it came from, whether it hit,
and the confidence level from the layer dictionary. `factSheet.warnings`
lists any layer that failed to respond (network/timeout), so a fact sheet
never silently drops data without saying so.

## What's confirmed vs. not — `src/config/layers.js`

Every layer's `confidence` field is honest: `confirmed` means we saw real,
distinguishing field data for it against the test parcel; `high`/`medium`
means strong inference from field names; `unconfirmed` means it returned
only `OBJECTID` + audit fields and genuinely isn't identified yet. This
file is the single place to edit as more layers get resolved — nothing
downstream hardcodes a layer id.

**Known gaps, not yet wired in:**
- Slum data (SRA's own service, `umd.nic.in/sramap/...` — different host,
  not yet capture-verified the same way as the MCGM layers).
- Metro **station points** for the "within 500m of a station" fact — only
  metro *corridor* layers (34, 1550) are confirmed so far.
- ~13 layers still return no distinguishing data (`UNKNOWN` category,
  excluded from the default battery). Resolving these needs either a
  parcel that actually intersects them, or the layer name straight from
  the `?f=pjson` schema endpoint.

## Getting ALL the data (not just one parcel)

**Do not** run `buildFactSheet` in a loop over every CTS parcel in Mumbai.
Almost every layer here is a city-wide reference layer (zones, reservations,
roads, heritage, CRZ, metro, gaothan) that exists independently of any
specific parcel — looping the per-parcel battery across ~300,000+ parcels
citywide would mean tens of millions of requests against a public
government server. Don't do that.

Instead, download each reference layer **once, in full**, and do spatial
joins locally from then on:

```bash
node examples/estimateAllLayers.js     # cheap — check scope before committing
node examples/bulkDownloadAll.js       # full reference layers -> data/layers/*.geojson
node examples/downloadAllParcels.js    # CTS index, ward-by-ward -> data/parcels/*.geojson
```

`bulkFetch.js` paginates with ID-based batching (robust against records
shifting mid-download, unlike offset paging) and reads each layer's real
`maxRecordCount` rather than guessing. `downloadAllParcels.js` is
resumable — it skips any ward whose output file already exists, so a
failed run partway through just needs re-running, not restarting.

Once both are downloaded, load them into PostGIS (reuse ai.dbot.in's
existing Postgres/pgvector instance rather than standing up a new
database) and do "what touches this parcel" as a local `ST_Intersects`
query. From that point, a live MCGM API call is only needed to catch
genuinely new construction/subdivisions between refresh cycles — not
for every lookup.

## Design notes

- **Concurrency capped at 6** (`factSheet.js`) — this is a public
  government server, not a load-testing target.
- **Every request retries twice with backoff** before failing — these
  servers are not always fast.
- **A single layer's failure never kills the whole fact sheet** — it's
  recorded in `warnings` and the rest proceeds. Verified in testing: a
  simulated failure on one item in a 20-item batch still returns all 20
  results, 19 successful + 1 error marker.
- **Geometry stays in Web Mercator (wkid 102100)** internally, matching
  what MCGM's services expect for the `geometry=` filter parameter on
  every confirmed request. If you need WGS84 for Leaflet/GeoJSON display,
  reproject at the display boundary — don't thread `outSR=4326` through
  the fact-battery calls, since that was never observed in the real
  capture and risks silently changing behavior on an unauthenticated
  government API we don't control.

## Next steps

1. Wire this into Map Studio's Express backend as an internal route
   (`/api/parcel-facts?ward=&village=&cts=`).
2. Build the DCPR regulation engine as a sibling module that consumes
   `factSheet.facts` and returns an FSI Statement / Scheme Comparison —
   keep it separate, per the architecture discussion.
3. Resolve the remaining `UNKNOWN` layers by testing against parcels that
   actually intersect them (a CRZ-adjacent plot, a heritage-listed
   building, a metro-corridor abutting plot).
4. Capture and wire in the SRA slum layer the same way this project
   captured the MCGM layers — same method, different host.
