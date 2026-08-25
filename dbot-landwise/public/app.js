import { evaluateAllSchemes } from './vendor/scheme-engine/src/index.js';

// zoomControl:false + added back at bottomleft — the default topleft position
// sat directly under the search box. Scale bar goes in the same corner.
const map = L.map('map', { zoomControl: false }).setView([19.076, 72.877], 12); // Mumbai default
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 19,
}).addTo(map);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

// Single shared canvas renderer for the reference-layer overlays below — with
// 42,000+ features across 10 categories, Leaflet's default SVG renderer (one
// DOM node per feature) would be very slow; canvas draws them as one bitmap.
const overlayRenderer = L.canvas({ padding: 0.5 });

let currentParcelLayer = null;

// Multi-parcel selection — Ctrl/Cmd+click adds a plot instead of replacing the
// current selection. selectedParcels only tracks the ones added this way (a
// plain click still goes through the single-select path and clears it) so the
// summary strip stays hidden until there's actually more than one to show.
const selectedParcels = new Map(); // "ward|village|cts" -> { ward, village, cts, area, geometry }
const multiSelectHighlightLayer = L.layerGroup().addTo(map);

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const panel = document.getElementById('details-panel');
const acknowledgeCheckbox = document.getElementById('acknowledge-checkbox');
const continueBtn = document.getElementById('continue-btn');
const additionalDetailsSection = document.getElementById('additional-details-section');

acknowledgeCheckbox.addEventListener('change', () => {
  continueBtn.disabled = !acknowledgeCheckbox.checked;
});

document.getElementById('panel-close').addEventListener('click', () => {
  clearSelection();
});

// Scaffolded sections (Project/Regulatory/Approval/Financial Details) — collapsed
// accordions for now, matching the reference product's layout. Content lands as
// the Scheme/FSI/Fees/Feasibility Engines get wired in; this just reserves the
// structure so it doesn't need to be re-laid-out later.
document.querySelectorAll('.accordion-toggle').forEach((btn) => {
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    const body = document.getElementById(btn.dataset.target);
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    body.classList.toggle('hidden', expanded);
  });
});

function clearSelection() {
  if (currentParcelLayer) { map.removeLayer(currentParcelLayer); currentParcelLayer = null; }
  selectedParcels.clear();
  renderMultiSelectSummary();
  renderMultiSelectHighlight();
  document.getElementById('panel-subtitle').textContent = 'No plot selected';
  ['project','city','ward','village','zone','dpzone','cts','plots','area','avgwidth','elevation','abutting','ownership','devtype']
    .forEach((id) => { const el = document.getElementById(`f-${id}`); if (el) el.textContent = '—'; });
  additionalDetailsSection.classList.add('hidden');
  acknowledgeCheckbox.checked = false;
  continueBtn.disabled = true;
  currentParcelData = null;
  const schemeListEl = document.getElementById('scheme-comparison-list');
  if (schemeListEl) schemeListEl.innerHTML = '';
}

// --- Static data access -----------------------------------------------
// This app reads pre-built static JSON (dbot-landwise/scripts/buildStaticData.js
// + buildFastStaticAssets.js) instead of calling an Express API — GitHub Pages
// serves static files only. Each ward's parcel geometry / fact battery is
// fetched once and cached in memory, same "load once, query in-process" shape
// the Express version used server-side.

let villagesIndexPromise = null;
let ctsIndexPromise = null;
const wardParcelsCache = new Map(); // wardCode -> FeatureCollection.features
const wardFactsCache = new Map(); // wardCode -> { "village|cts": facts }

function wardFileCode(ward) {
  return ward.replace('/', '-');
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function loadVillagesIndex() {
  if (!villagesIndexPromise) villagesIndexPromise = fetchJson('data/villages.json');
  return villagesIndexPromise;
}

function loadCtsIndex() {
  if (!ctsIndexPromise) ctsIndexPromise = fetchJson('data/cts-index.json');
  return ctsIndexPromise;
}

async function loadWardParcels(ward) {
  const code = wardFileCode(ward);
  if (!wardParcelsCache.has(code)) {
    wardParcelsCache.set(code, fetchJson(`data/parcels/ward_${code}.geojson`).then((fc) => fc.features));
  }
  return wardParcelsCache.get(code);
}

async function loadWardFacts(ward) {
  const code = wardFileCode(ward);
  if (!wardFactsCache.has(code)) {
    wardFactsCache.set(code, fetchJson(`data/facts/ward_${code}.json`));
  }
  return wardFactsCache.get(code);
}

// --- Search: as-you-type, matches "CTS / village" pattern from the reference ---
let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResults.classList.add('hidden'); return; }
  searchDebounce = setTimeout(() => runSearch(q), 200);
});

async function runSearch(query) {
  const q = query.toLowerCase();
  const [villages, ctsParcels] = await Promise.all([loadVillagesIndex(), loadCtsIndex()]);

  const villageMatches = villages
    .filter((v) => v.village.toLowerCase().includes(q))
    .map((v) => ({ type: 'village', ...v }));

  // CTS numbers are short and often numeric/alphanumeric (e.g. "97B", "1/1061") —
  // require at least 2 chars (already enforced by the input listener) so this
  // doesn't fire on a single keystroke, but otherwise match anywhere in the
  // CTS/CS number, same substring behavior as village search.
  const ctsMatches = ctsParcels
    .filter((p) => p.cts && p.cts.toLowerCase().includes(q))
    .slice(0, 15)
    .map((p) => ({ type: 'cts', ...p }));

  renderSearchResults([...ctsMatches, ...villageMatches].slice(0, 15));
}

function renderSearchResults(matches) {
  searchResults.innerHTML = '';
  if (!matches.length) { searchResults.classList.add('hidden'); return; }
  for (const m of matches) {
    const div = document.createElement('div');
    div.className = 'result-item';
    if (m.type === 'cts') {
      div.textContent = `CTS ${m.cts} — ${m.village} (Ward ${m.ward})`;
      div.addEventListener('click', () => selectCtsResult(m.ward, m.village, m.cts));
    } else {
      div.textContent = `${m.village} (Ward ${m.ward})`;
      div.addEventListener('click', () => selectVillage(m.ward, m.village));
    }
    searchResults.appendChild(div);
  }
  searchResults.classList.remove('hidden');
}

async function selectVillage(ward, village) {
  searchResults.classList.add('hidden');
  searchInput.value = village;
  const parcels = await loadWardParcels(ward);
  const matching = parcels.filter((p) => p.properties.VILLAGE === village);
  if (!matching.length) return;
  const bounds = L.geoJSON({ type: 'FeatureCollection', features: matching }).getBounds();
  map.fitBounds(bounds, { maxZoom: 17 }); // triggers moveend -> updateVisibleWardParcels renders it
}

async function selectCtsResult(ward, village, cts) {
  searchResults.classList.add('hidden');
  searchInput.value = cts;
  await selectVillage(ward, village);
  await selectParcel(ward, village, cts);
}

// --- City-wide parcel boundaries + CTS labels, viewport-driven -----------
// Per direct feedback: parcels should be visible on the map like the other
// reference layers (not gated behind a search), for ALL the data we have, not
// just a searched village. 135,342 parcels citywide is too much to load or
// render at once, so instead: below PARCELS_MIN_ZOOM nothing renders (city
// overview is meaningless at individual-plot granularity anyway); at or above
// it, whichever ward(s) overlap the current viewport get their parcel file
// loaded (cached after first fetch, same as before) and rendered, and wards
// that scroll out of view get removed from the map (but stay cached) to keep
// the DOM/canvas bounded. CTS labels layer on top of that, same zoom-gated
// idea, past a tighter threshold since they need more room to read.
const PARCELS_MIN_ZOOM = 15;
// Raised from 16 -- dense areas (lots of small subdivided plots) still produced
// an unreadable overlapping mess of text at 16. Combined with the pixel-distance
// decluttering in the label-building loop below (skip a label if it would land
// too close to one already placed this pass), this keeps labels legible instead
// of just correct-but-illegible.
const CTS_LABEL_MIN_ZOOM = 18;
const LABEL_MIN_PIXEL_SPACING = 42;
const wardParcelLayers = new Map(); // wardCode -> { parcels, polygons: L.GeoJSON, onMap: boolean }
let wardBoundsPromise = null;

function loadWardBounds() {
  if (!wardBoundsPromise) wardBoundsPromise = fetchJson('data/ward-bounds.json');
  return wardBoundsPromise;
}

function parcelCentroid(geometry) {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [y / ring.length, x / ring.length];
}

function boundsOverlapWard(mapBounds, wardBbox) {
  const [minLon, minLat, maxLon, maxLat] = wardBbox;
  return mapBounds.getWest() <= maxLon && mapBounds.getEast() >= minLon &&
    mapBounds.getSouth() <= maxLat && mapBounds.getNorth() >= minLat;
}

async function ensureWardParcelLayer(ward) {
  const code = wardFileCode(ward);
  if (wardParcelLayers.has(code)) return wardParcelLayers.get(code);

  const parcels = await loadWardParcels(ward);
  const polygons = L.geoJSON(
    { type: 'FeatureCollection', features: parcels.map((p) => ({
      type: 'Feature',
      properties: { cts: p.properties.CTS_CS_NO, ward, village: p.properties.VILLAGE },
      geometry: p.geometry,
    })) },
    {
      renderer: overlayRenderer,
      style: { color: '#0b1f3a', weight: 1, fillOpacity: 0.05 },
      onEachFeature: (feature, layer) => {
        layer.on('click', (e) => {
          const { ward, village, cts } = feature.properties;
          if (e.originalEvent?.ctrlKey || e.originalEvent?.metaKey) {
            toggleParcelSelection(ward, village, cts);
          } else {
            selectedParcels.clear();
            selectParcel(ward, village, cts);
          }
        });
      },
    },
  );

  // parcels stays around (not just the built polygon layer) so the viewport-scoped
  // label pass below can filter it without re-fetching.
  const entry = { parcels, polygons, onMap: false };
  wardParcelLayers.set(code, entry);
  return entry;
}

let parcelsEnabled = true;
const parcelsToggleLayer = L.layerGroup(); // hooks the "Parcels" checkbox into the same layer control as the other 10

// CTS labels are individual DOM markers (Leaflet has no built-in canvas text
// primitive), so unlike the polygons above they can't just be "the whole ward,
// canvas-rendered" — a dense ward (P/N has 13,927 parcels, K/W has 11,448) would
// mean that many DOM nodes the instant the ward loads, regardless of how much of
// it is actually on screen. That was the real lag: labels for an entire ward were
// being created up front. Fixed by only ever creating markers for parcels whose
// centroid falls inside the CURRENT viewport, rebuilt on every moveend, instead of
// once per ward at load time.
const labelLayer = L.layerGroup();

// moveend can fire in quick succession (zoom animations, programmatic setView/setZoom
// calls) faster than a previous invocation's awaited fetches resolve. Without guarding
// against that, a slow, now-stale invocation can finish AFTER a newer one already
// cleaned up, and re-add wards for a viewport/zoom that's no longer current — caught in
// testing (rapid zoom out then back in left stale wards rendered). Each invocation
// captures its own generation number and checks it's still current after every await;
// a superseded invocation abandons itself instead of touching the map.
let renderGeneration = 0;

function centroidInBounds(centroid, bounds) {
  const [lat, lon] = centroid;
  return lat >= bounds.getSouth() && lat <= bounds.getNorth() && lon >= bounds.getWest() && lon <= bounds.getEast();
}

async function updateVisibleWardParcels() {
  const myGeneration = ++renderGeneration;
  const zoom = map.getZoom();
  if (!parcelsEnabled || zoom < PARCELS_MIN_ZOOM) {
    for (const entry of wardParcelLayers.values()) {
      if (entry.onMap) { map.removeLayer(entry.polygons); entry.onMap = false; }
    }
    if (map.hasLayer(labelLayer)) map.removeLayer(labelLayer);
    labelLayer.clearLayers();
    return;
  }

  const wardBounds = await loadWardBounds();
  if (myGeneration !== renderGeneration) return; // superseded while awaiting

  const mapBounds = map.getBounds();
  const overlapping = new Set(Object.keys(wardBounds).filter((w) => boundsOverlapWard(mapBounds, wardBounds[w])));

  for (const [code, entry] of wardParcelLayers) {
    if (!overlapping.has(code.replace('-', '/')) && entry.onMap) {
      map.removeLayer(entry.polygons);
      entry.onMap = false;
    }
  }

  for (const ward of overlapping) {
    const entry = await ensureWardParcelLayer(ward);
    if (myGeneration !== renderGeneration) return; // superseded mid-loop
    if (!entry.onMap) { entry.polygons.addTo(map); entry.onMap = true; }
  }
  if (myGeneration !== renderGeneration) return;

  const showLabels = zoom >= CTS_LABEL_MIN_ZOOM;
  labelLayer.clearLayers();
  if (showLabels) {
    const placedPoints = []; // pixel coords of labels already placed this pass
    for (const ward of overlapping) {
      const entry = wardParcelLayers.get(wardFileCode(ward));
      if (!entry) continue;
      for (const p of entry.parcels) {
        const centroid = parcelCentroid(p.geometry);
        if (!centroidInBounds(centroid, mapBounds)) continue;
        const px = map.latLngToContainerPoint(centroid);
        const tooClose = placedPoints.some((q) => px.distanceTo(q) < LABEL_MIN_PIXEL_SPACING);
        if (tooClose) continue;
        placedPoints.push(px);
        L.marker(centroid, {
          icon: L.divIcon({ className: 'cts-label', html: p.properties.CTS_CS_NO, iconSize: null }),
          interactive: false,
        }).addTo(labelLayer);
      }
    }
    if (!map.hasLayer(labelLayer)) labelLayer.addTo(map);
  } else if (map.hasLayer(labelLayer)) {
    map.removeLayer(labelLayer);
  }
}

map.on('moveend', updateVisibleWardParcels);
updateVisibleWardParcels();

async function selectParcel(ward, village, cts, { fitView = true } = {}) {
  const facts = await loadWardFacts(ward);
  const details = facts[`${village}|${cts}`];
  if (!details) {
    console.error(`No precomputed facts for ${ward}/${village}/${cts}`);
    return;
  }
  populatePanel({ ...details, location: buildLocation(ward, village, cts, details) });

  if (currentParcelLayer) map.removeLayer(currentParcelLayer);
  currentParcelLayer = L.geoJSON(details.geometry, { className: 'parcel-highlight' }).addTo(map);
  // Adding to a multi-select shouldn't yank the view to fit just the newly-added
  // plot -- the user is deliberately looking at several nearby ones together, so
  // only the very first (primary) selection gets to re-center/zoom the map.
  if (fitView) map.fitBounds(currentParcelLayer.getBounds(), { maxZoom: 18, padding: [40, 40] });

  renderMultiSelectSummary();
  renderMultiSelectHighlight();
}

// Adds/removes one parcel from the multi-select set without disturbing whatever
// else is selected. The panel keeps showing the full Location/Land/Additional/
// Scheme detail for whichever parcel was clicked most recently (a true merged
// multi-parcel fact battery would need re-running the spatial join against a
// unioned geometry, which this static site can't do client-side) -- the strip
// above the panel is what shows the whole selection, with a running total area.
async function toggleParcelSelection(ward, village, cts) {
  const key = `${ward}|${village}|${cts}`;
  if (selectedParcels.has(key)) {
    selectedParcels.delete(key);
    renderMultiSelectSummary();
    renderMultiSelectHighlight();
    return;
  }

  const facts = await loadWardFacts(ward);
  const details = facts[`${village}|${cts}`];
  if (!details) return;
  selectedParcels.set(key, { ward, village, cts, area: details.land?.area ?? null, geometry: details.geometry });
  await selectParcel(ward, village, cts, { fitView: false }); // focus its details, but don't yank the view
}

function renderMultiSelectHighlight() {
  multiSelectHighlightLayer.clearLayers();
  for (const { geometry } of selectedParcels.values()) {
    L.geoJSON(geometry, { style: { color: '#c8a24a', weight: 2, fillOpacity: 0.3 } }).addTo(multiSelectHighlightLayer);
  }
}

function renderMultiSelectSummary() {
  const summaryEl = document.getElementById('multi-select-summary');
  const listEl = document.getElementById('multi-select-list');
  const totalEl = document.getElementById('multi-select-total');
  if (selectedParcels.size < 2) { summaryEl.classList.add('hidden'); return; }
  summaryEl.classList.remove('hidden');
  listEl.innerHTML = '';
  let total = 0;
  for (const p of selectedParcels.values()) {
    total += p.area ?? 0;
    const row = document.createElement('div');
    row.className = 'multi-select-row';
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.textContent = '✓';
    const label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = `CTS ${p.cts} — ${p.village} (${formatNumber(p.area)} sq m)`;
    const remove = document.createElement('span');
    remove.className = 'row-remove';
    remove.textContent = '×';
    remove.addEventListener('click', (e) => { e.stopPropagation(); toggleParcelSelection(p.ward, p.village, p.cts); });
    row.appendChild(tick);
    row.appendChild(label);
    row.appendChild(remove);
    row.addEventListener('click', () => selectParcel(p.ward, p.village, p.cts));
    listEl.appendChild(row);
  }
  totalEl.textContent = `Total area: ${formatNumber(total)} sq m across ${selectedParcels.size} plots`;
}

function buildLocation(ward, village, cts, details) {
  return {
    project: 'New Project',
    city: 'Mumbai',
    ward,
    village,
    zone: details.location.zone,
    dpZone: details.location.dpZone,
    ctsTps: cts,
    numPlots: 1,
  };
}

function populatePanel(details) {
  document.getElementById('panel-subtitle').textContent = '1 plot selected';

  const loc = details.location;
  setText('f-project', loc.project);
  setText('f-city', loc.city);
  setText('f-ward', loc.ward);
  setText('f-village', loc.village);
  setText('f-zone', loc.zone);
  setText('f-dpzone', loc.dpZone);
  setText('f-cts', loc.ctsTps);
  setText('f-plots', loc.numPlots);

  const land = details.land;
  setText('f-area', formatNumber(land.area));
  setText('f-avgwidth', land.avgWidth != null ? `${formatNumber(land.avgWidth)}${land.avgWidthApproximate ? ' (approx.)' : ''}` : '—');
  setText('f-elevation', land.avgElevation ?? 'Enter manually');
  setText('f-excluded', land.excluded ?? 0);
  setText('f-abutting', land.abuttingRoad ?? 'Enter manually');
  setText('f-ownership', land.ownership ?? 'Enter manually');
  setText('f-devtype', land.developmentType ?? 'Enter manually');

  populateAdditionalDetails(details.additionalDetails, details.allIntersectingFeatures);

  currentParcelData = details;
  renderSchemeComparison();
}

// --- Scheme Engine wiring -----------------------------------------------
// scheme-engine is a standalone, deterministic module (see /scheme-engine in the
// repo root) — vendored here as plain browser ES modules (public/vendor/scheme-engine/,
// kept in sync by scripts/syncSchemeEngine.js) since GitHub Pages has no bundler.
// Rules decide eligibility; this file only maps our precomputed facts into the
// shape evaluateAllSchemes expects and renders the result — no eligibility logic
// lives here.

let currentParcelData = null;

// DP_0's ZONE_CODE2 values, confirmed against the actual downloaded layer data:
// I, NA, NDZ, R, G-Z, "NDZ/SDZ (Slum)", C, SDZ. Only R/C and I map cleanly onto
// the Scheme Engine's RESIDENTIAL_COMMERCIAL/INDUSTRIAL — the rest (No
// Development Zone, Special Development Zone, Green Zone, slum-designated) don't
// fit either category, so they stay unmapped (null) rather than forced into one.
function deriveDpZoneUse(allFeatures) {
  const code = allFeatures.find((f) => f.layer === 'DP_0')?.properties?.ZONE_CODE2;
  if (code === 'R' || code === 'C') return 'RESIDENTIAL_COMMERCIAL';
  if (code === 'I') return 'INDUSTRIAL';
  return null;
}

function deriveZoneClassification(allFeatures) {
  const dp74 = allFeatures.find((f) => f.layer === 'DP_74');
  const dp0 = allFeatures.find((f) => f.layer === 'DP_0');
  if (dp74?.properties?.SUBURB === 'ISLAND CITY') return 'ISLAND_CITY';
  if (dp0?.properties?.SUBURBS === 'CITY') return 'ISLAND_CITY';
  if (dp74 || dp0) return 'SUBURBS';
  return null;
}

// DP_193/DP_194 ("Regular Line road width") carry WIDTH_RL as an inconsistently
// formatted string ("45.70M", "36.60 M", "36.60") -- parseFloat handles all of
// those the same way since it just stops at the first non-numeric character.
// A parcel touching two road-width features with DIFFERENT values is a real
// ambiguity (which one governs?) with no sourced tie-breaking rule -- stays
// null rather than picking one arbitrarily, same "flag, don't silently
// resolve" rule as everywhere else in this project.
function deriveRoadWidthM(allFeatures) {
  const widths = new Set();
  for (const f of allFeatures) {
    if (f.layer === 'DP_193' || f.layer === 'DP_194') {
      const n = parseFloat(f.properties?.WIDTH_RL);
      if (!Number.isNaN(n)) widths.add(n);
    }
  }
  return widths.size === 1 ? [...widths][0] : null;
}

function deriveParcelFacts(details) {
  const allFeatures = details.allIntersectingFeatures ?? [];
  return {
    areaSqm: details.land?.area ?? null,
    zoneClassification: deriveZoneClassification(allFeatures),
    dpZoneUse: deriveDpZoneUse(allFeatures),
    roadWidthM: deriveRoadWidthM(allFeatures),
    isBARCArea: null, // no signal for this special case in the data we have
  };
}

function readBuildingFactsForm() {
  const num = (id) => { const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
  const bool = (id) => { const v = document.getElementById(id).value; return v === '' ? null : v === 'true'; };
  const str = (id) => { const v = document.getElementById(id).value; return v === '' ? null : v; };
  return {
    buildingAgeYears: num('bf-age'),
    isCessed: bool('bf-cessed'),
    tenantOccupancyCount: num('bf-tenants'),
    isSocietyRegistered: bool('bf-society'),
    ownershipType: str('bf-ownership'),
    developmentType: str('bf-devtype'),
  };
}

document.querySelectorAll('#project-details-body input, #project-details-body select').forEach((el) => {
  el.addEventListener('change', renderSchemeComparison);
});

function renderSchemeComparison() {
  const listEl = document.getElementById('scheme-comparison-list');
  if (!currentParcelData) { listEl.innerHTML = ''; return; }

  const parcelFacts = deriveParcelFacts(currentParcelData);
  const buildingFacts = readBuildingFactsForm();
  const results = evaluateAllSchemes(parcelFacts, buildingFacts);

  listEl.innerHTML = '';
  for (const result of results) {
    const card = document.createElement('div');
    card.className = 'scheme-card';

    const header = document.createElement('div');
    header.className = 'scheme-card-header';
    const title = document.createElement('span');
    title.className = 'scheme-card-title';
    title.textContent = `${result.title} (${result.schemeId.replace('REG_', '')})`;
    const badge = document.createElement('span');
    badge.className = `scheme-badge ${result.status}`;
    badge.textContent = SCHEME_STATUS_LABELS[result.status] ?? result.status;
    header.appendChild(title);
    header.appendChild(badge);
    card.appendChild(header);

    if (result.reasons?.length) {
      const list = document.createElement('ul');
      list.className = 'scheme-card-reasons';
      for (const reason of result.reasons) {
        const li = document.createElement('li');
        li.textContent = reason.text;
        list.appendChild(li);
      }
      card.appendChild(list);
    }

    if (result.data) {
      const dataEl = document.createElement('div');
      dataEl.className = 'scheme-card-data';
      const table = document.createElement('table');
      for (const [key, value] of Object.entries(result.data)) {
        if (value == null) continue;
        const row = document.createElement('tr');
        const keyCell = document.createElement('td');
        keyCell.textContent = fieldLabel(key);
        const valCell = document.createElement('td');
        valCell.textContent = typeof value === 'number' ? formatNumber(value) : String(value);
        row.appendChild(keyCell);
        row.appendChild(valCell);
        table.appendChild(row);
      }
      dataEl.appendChild(table);
      card.appendChild(dataEl);
    }

    listEl.appendChild(card);
  }
}

const SCHEME_STATUS_LABELS = {
  ELIGIBLE: '🟢 Eligible',
  POTENTIALLY_ELIGIBLE: '🟡 Potentially Eligible',
  NOT_ELIGIBLE: '🔴 Not Eligible',
  NOT_EVALUABLE: '⚪ Not Evaluable',
};

function fieldLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function populateAdditionalDetails(ad, allFeatures) {
  if (!ad) { additionalDetailsSection.classList.add('hidden'); return; }
  additionalDetailsSection.classList.remove('hidden');

  const c = ad.confident;
  setText('ad-aai', c.heightPermittedByAAI != null ? formatNumber(c.heightPermittedByAAI) : 'Not applicable here');
  setText('ad-road', c.areaUnderDPRoadSetbackSqm != null ? formatNumber(c.areaUnderDPRoadSetbackSqm) : '0');
  setText('ad-resarea', c.areaUnderReservationsSqm != null ? formatNumber(c.areaUnderReservationsSqm) : '0');
  setText('ad-rescount', c.reservationCount);

  // Real/inferred facts: plain badge, same visual language as the confidence
  // badges in "All intersecting layers" below — not editable, since these are
  // computed, not user opinion.
  setBadge('ad-gaothan-badge', c.fallsInGaothanKoliwadaAdivasipada);
  setBadge('ad-industrial-badge', ad.flagged.fallsInIndustrialZone.value);
  setBadge('ad-crz-badge', ad.flagged.fallsInCRZ.value);
  setBadge('ad-metro-badge', ad.flagged.withinMetroProximity.value);

  // Genuine gaps: no computed value exists — a plain select the user sets
  // themselves, always starting at "no data", never a guessed default.
  document.getElementById('ad-cbd-select').value = '';
  document.getElementById('ad-slums-select').value = '';

  renderNocList(allFeatures ?? []);

  const featureListEl = document.getElementById('ad-feature-list');
  const countEl = document.getElementById('ad-feature-count');
  featureListEl.innerHTML = '';
  const features = allFeatures ?? [];
  countEl.textContent = features.length;
  for (const feat of features) {
    const row = document.createElement('div');
    row.className = 'feature-item';
    const label = document.createElement('span');
    label.className = 'feature-label';
    label.textContent = feat.label;
    const badge = document.createElement('span');
    badge.className = `feature-confidence ${feat.confidence}`;
    badge.textContent = feat.confidence;
    row.appendChild(label);
    row.appendChild(badge);
    featureListEl.appendChild(row);
  }
}

function setBadge(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ? 'Yes' : 'No';
  el.classList.remove('yes', 'no');
  el.classList.add(value ? 'yes' : 'no');
}

// --- NOC Requirement Registry ---------------------------------------------
// Per the brief's own NOC Registry note: government approval isn't just "which
// DCPR scheme applies" but "which department signs off on what" -- a genuinely
// different piece of knowledge. Built from the same allIntersectingFeatures
// battery already computed per parcel, honestly: "Applicable" means the real
// spatial trigger was found for THIS parcel; department routing itself is
// confirmed only for Airport/AAI (DD/43's PERMISSIBL matched the reference
// screenshot's own 150m threshold) -- the rest have a real spatial fact but
// unconfirmed routing, or (Fire, Traffic Road) no data at all. Never invented.
const NOC_LINES = [
  {
    name: 'Airport (>150m): AAI',
    dept: 'Airports Authority of India',
    hasTrigger: (f) => f.some((x) => x.layer === 'DD_43'),
    note: 'Confirmed spatial trigger and routing -- DD/43\'s height-restriction value matches the 150m AAI threshold.',
  },
  {
    name: 'Heritage Buffer',
    dept: 'Heritage Committee',
    hasTrigger: (f) => f.some((x) => ['DP_77', 'DP_78', 'DP_79'].includes(x.layer)),
    note: 'Spatial fact is real (DP/77-79); the "routes to Heritage Committee" step itself isn\'t independently confirmed.',
  },
  {
    name: 'Existing Road',
    dept: 'BMC Ward Authority',
    hasTrigger: (f) => f.some((x) => x.layer === 'DP_44'),
    note: 'Spatial fact is real (DP/44); routing not independently confirmed.',
  },
  {
    name: 'Storm Water / Sewerage / Waterpipes',
    dept: 'BMC SWD / HE Departments',
    hasTrigger: (f) => f.some((x) => ['AKO_6', 'AKO_55'].includes(x.layer)),
    note: 'Underlying utility data exists (AKO/6, AKO/55); routing not independently confirmed.',
  },
  {
    name: 'Fire',
    dept: 'BMC Chief Fire Officer',
    hasTrigger: null,
    note: 'No jurisdiction data identified at all -- always Unknown, never guessed.',
  },
  {
    name: 'Traffic Road',
    dept: 'BMC Roads & Traffic Department',
    hasTrigger: null,
    note: 'Unclear whether this is a distinct layer/classification from "Existing Road" or the same data under a different attribute -- not checked, always Unknown.',
  },
];

function renderNocList(allFeatures) {
  const listEl = document.getElementById('noc-list');
  listEl.innerHTML = '';
  for (const line of NOC_LINES) {
    const status = line.hasTrigger == null ? 'unknown' : (line.hasTrigger(allFeatures) ? 'applicable' : 'not-applicable');
    const statusLabel = { applicable: 'Applicable', 'not-applicable': 'Not Applicable', unknown: 'Unknown' }[status];
    const row = document.createElement('div');
    row.className = 'noc-item';
    row.title = line.note;
    row.innerHTML = `<span><span class="noc-name">${line.name}</span><span class="noc-dept">${line.dept}</span></span>` +
      `<span class="noc-status ${status}">${statusLabel}</span>`;
    listEl.appendChild(row);
  }
}

// --- Generic inline editing -------------------------------------------------
// Every .field.editable's pencil/Edit button wires up the same way: replace the
// adjacent .value span with a real input on click, commit back to a span on
// blur/Enter. Works for every manual-entry field in the panel (Area, Avg
// Width, Ownership, ASR rates, slum area, BUA retained, etc.) without needing
// a per-field handler.
document.querySelectorAll('.field.editable .edit-btn').forEach((btn) => {
  btn.addEventListener('click', () => startInlineEdit(btn));
});

function startInlineEdit(btn) {
  const field = btn.closest('.field');
  const valueEl = field.querySelector('.value');
  if (!valueEl || field.querySelector('input.inline-edit')) return;

  const isNumeric = field.querySelector('.unit') != null;
  const placeholderTexts = ['Not yet available', 'Enter manually', '—'];
  const currentText = valueEl.textContent.trim();
  const startValue = placeholderTexts.includes(currentText) ? '' : currentText;

  const input = document.createElement('input');
  input.type = isNumeric ? 'number' : 'text';
  input.className = 'inline-edit';
  input.value = startValue;
  const fieldId = valueEl.id;
  valueEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const newValue = input.value.trim();
    const span = document.createElement('span');
    span.className = 'value';
    span.id = fieldId;
    span.textContent = newValue || currentText;
    input.replaceWith(span);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// --- City-wide reference-layer overlays -------------------------------
// Precomputed by scripts/buildMapLayers.js: 10 categories, 42,015 features
// total, simplified for display and stripped of housekeeping fields.
// Deliberately excludes AKO_1060/AKO_6/AKO_55 (building heights + utility
// data, 195,618 features) — those stay available per-parcel in the
// Additional Land Details panel instead of as a city-wide overlay, where
// they'd be unusable regardless of simplification. See that script's header
// comment for the full reasoning.

// Lighter than the first pass — thin strokes, low fill — plus only the
// boundary-type / lower-density categories are ON by default. The dense
// ones (reservations, designations, roads, heritage, gaothan — thousands
// of small polygons each) are still available with zero extra clicks
// beyond opening the layer control, just not pre-loaded on top of each
// other by default, per direct feedback that all-10-at-once reads as messy.
const MAP_LAYER_STYLES = {
  ZONE: { color: '#5b8dd6', weight: 0.6, fillOpacity: 0.05 },
  RESERVATION: { color: '#e08a2b', weight: 0.6, fillOpacity: 0.12 },
  DESIGNATION: { color: '#9b6bd6', weight: 0.6, fillOpacity: 0.08 },
  ROAD: { color: '#4a4a4a', weight: 0.8, fillOpacity: 0.1 },
  HERITAGE: { color: '#a12f45', weight: 1, fillOpacity: 0.25 },
  CRZ: { color: '#1f9c9c', weight: 1.5, fillOpacity: 0.15, dashArray: '4 3' },
  HEIGHT: { color: '#c62828', weight: 1, fillOpacity: 0.02, dashArray: '2 4' },
  METRO: { color: '#2e8b3d', weight: 2.5, fillOpacity: 0 },
  GAOTHAN: { color: '#8a6a3a', weight: 0.8, fillOpacity: 0.18 },
  ADMIN: { color: '#0b1f3a', weight: 1, fillOpacity: 0, dashArray: '6 4' },
};

const MAP_LAYER_LABELS = {
  ZONE: 'Zones', RESERVATION: 'Reservations', DESIGNATION: 'Designations', ROAD: 'Roads',
  HERITAGE: 'Heritage', CRZ: 'CRZ', HEIGHT: 'Height / Airport NOC', METRO: 'Metro',
  GAOTHAN: 'Gaothan/Koliwada', ADMIN: 'Admin boundaries',
};

// Per direct feedback: all 10 reference layers off by default now — the
// always-on, city-wide layer is the parcel/CTS boundary layer above instead.
// Every category is still in the layer control, one click away.
const MAP_LAYER_DEFAULT_ON = new Set([]);

// Fields worth showing in a layer feature's popup, in priority order — the
// property sets differ per source layer, so this just takes whichever of
// these exist rather than dumping every field.
const POPUP_FIELD_PRIORITY = [
  'NAME', 'ROAD_NAME', 'WIDTH_RL', 'RESERVATION', 'FINAL_LABEL', 'CODE_LABEL_31',
  'AUTHORITY', 'TYPE', 'PERMISSIBL', 'ZONE_CODE2', 'SUBURBS', 'SUBURB', 'WARD', 'VILLAGE',
];

function popupHtmlFor(feature) {
  const p = feature.properties;
  const rows = [`<strong>${p.label}</strong>`];
  for (const key of POPUP_FIELD_PRIORITY) {
    if (p[key] != null && p[key] !== '') rows.push(`${key}: ${p[key]}`);
  }
  return rows.join('<br>');
}

async function loadMapLayers() {
  const layersControl = L.control.layers(null, null, { collapsed: false, position: 'topright' }).addTo(map);

  // "Parcels / CTS boundaries" — on by default, above the 10 reference-layer
  // toggles. parcelsToggleLayer itself never holds real data; it just hooks a
  // checkbox into the shared control so this can be turned off the same way
  // as everything else, while the actual polygons/labels are the
  // viewport-driven per-ward layers managed by updateVisibleWardParcels.
  parcelsToggleLayer.addTo(map);
  layersControl.addOverlay(parcelsToggleLayer, 'Parcels / CTS boundaries');
  map.on('overlayadd', (e) => {
    if (e.layer !== parcelsToggleLayer) return;
    parcelsEnabled = true;
    updateVisibleWardParcels();
  });
  map.on('overlayremove', (e) => {
    if (e.layer !== parcelsToggleLayer) return;
    parcelsEnabled = false;
    updateVisibleWardParcels();
  });

  await Promise.all(Object.keys(MAP_LAYER_STYLES).map(async (category) => {
    let data;
    try {
      data = await fetchJson(`data/mapLayers/${category}.geojson`);
    } catch (err) {
      console.error(`Failed to load map layer ${category}:`, err);
      return;
    }
    const style = MAP_LAYER_STYLES[category];
    const layer = L.geoJSON(data, {
      renderer: overlayRenderer,
      style: () => style,
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, { ...style, radius: 4 }),
      onEachFeature: (feature, layer) => layer.bindPopup(popupHtmlFor(feature)),
    });
    if (MAP_LAYER_DEFAULT_ON.has(category)) layer.addTo(map);
    layersControl.addOverlay(layer, `${MAP_LAYER_LABELS[category]} (${data.features.length})`);
  }));
}

loadMapLayers();
clearSelection();

// Module scripts don't leak top-level bindings onto window the way classic scripts
// do — exposed deliberately here for browser-console debugging and headless-browser
// testing, not used by any app code itself.
window.__app = { map, wardParcelLayers, labelLayer };
