const map = L.map('map', { zoomControl: true }).setView([19.076, 72.877], 12); // Mumbai default
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 19,
}).addTo(map);

// Single shared canvas renderer for the reference-layer overlays below — with
// 42,000+ features across 10 categories, Leaflet's default SVG renderer (one
// DOM node per feature) would be very slow; canvas draws them as one bitmap.
const overlayRenderer = L.canvas({ padding: 0.5 });

let currentParcelLayer = null;

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
  document.getElementById('panel-subtitle').textContent = 'No plot selected';
  ['project','city','ward','village','zone','dpzone','cts','plots','area','avgwidth','elevation','abutting','ownership','devtype']
    .forEach((id) => { const el = document.getElementById(`f-${id}`); if (el) el.textContent = '—'; });
  additionalDetailsSection.classList.add('hidden');
  acknowledgeCheckbox.checked = false;
  continueBtn.disabled = true;
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
const CTS_LABEL_MIN_ZOOM = 16;
const wardParcelLayers = new Map(); // wardCode -> { polygons: L.GeoJSON, labels: L.LayerGroup, onMap: boolean }
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
        layer.on('click', () => selectParcel(feature.properties.ward, feature.properties.village, feature.properties.cts));
      },
    },
  );
  const labels = L.layerGroup(parcels.map((p) => L.marker(parcelCentroid(p.geometry), {
    icon: L.divIcon({ className: 'cts-label', html: p.properties.CTS_CS_NO, iconSize: null }),
    interactive: false,
  })));

  const entry = { polygons, labels, onMap: false };
  wardParcelLayers.set(code, entry);
  return entry;
}

let parcelsEnabled = true;
const parcelsToggleLayer = L.layerGroup(); // hooks the "Parcels" checkbox into the same layer control as the other 10

// moveend can fire in quick succession (zoom animations, programmatic setView/setZoom
// calls) faster than a previous invocation's awaited fetches resolve. Without guarding
// against that, a slow, now-stale invocation can finish AFTER a newer one already
// cleaned up, and re-add wards for a viewport/zoom that's no longer current — caught in
// testing (rapid zoom out then back in left stale wards rendered). Each invocation
// captures its own generation number and checks it's still current after every await;
// a superseded invocation abandons itself instead of touching the map.
let renderGeneration = 0;

async function updateVisibleWardParcels() {
  const myGeneration = ++renderGeneration;
  const zoom = map.getZoom();
  if (!parcelsEnabled || zoom < PARCELS_MIN_ZOOM) {
    for (const entry of wardParcelLayers.values()) {
      if (entry.onMap) { map.removeLayer(entry.polygons); map.removeLayer(entry.labels); entry.onMap = false; }
    }
    return;
  }

  const wardBounds = await loadWardBounds();
  if (myGeneration !== renderGeneration) return; // superseded while awaiting

  const mapBounds = map.getBounds();
  const overlapping = new Set(Object.keys(wardBounds).filter((w) => boundsOverlapWard(mapBounds, wardBounds[w])));

  for (const [code, entry] of wardParcelLayers) {
    if (!overlapping.has(code.replace('-', '/')) && entry.onMap) {
      map.removeLayer(entry.polygons);
      map.removeLayer(entry.labels);
      entry.onMap = false;
    }
  }

  const showLabels = zoom >= CTS_LABEL_MIN_ZOOM;
  for (const ward of overlapping) {
    const entry = await ensureWardParcelLayer(ward);
    if (myGeneration !== renderGeneration) return; // superseded mid-loop
    if (!entry.onMap) { entry.polygons.addTo(map); entry.onMap = true; }
    const labelsShown = map.hasLayer(entry.labels);
    if (showLabels && !labelsShown) entry.labels.addTo(map);
    if (!showLabels && labelsShown) map.removeLayer(entry.labels);
  }
}

map.on('moveend', updateVisibleWardParcels);
updateVisibleWardParcels();

async function selectParcel(ward, village, cts) {
  const facts = await loadWardFacts(ward);
  const details = facts[`${village}|${cts}`];
  if (!details) {
    console.error(`No precomputed facts for ${ward}/${village}/${cts}`);
    return;
  }
  populatePanel({ ...details, location: buildLocation(ward, village, cts, details) });

  if (currentParcelLayer) map.removeLayer(currentParcelLayer);
  currentParcelLayer = L.geoJSON(details.geometry, { className: 'parcel-highlight' }).addTo(map);
  map.fitBounds(currentParcelLayer.getBounds(), { maxZoom: 18, padding: [40, 40] });
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
}

function populateAdditionalDetails(ad, allFeatures) {
  if (!ad) { additionalDetailsSection.classList.add('hidden'); return; }
  additionalDetailsSection.classList.remove('hidden');

  const c = ad.confident;
  setText('ad-aai', c.heightPermittedByAAI != null ? formatNumber(c.heightPermittedByAAI) : 'Not applicable here');
  setText('ad-road', c.areaUnderDPRoadSetbackSqm != null ? formatNumber(c.areaUnderDPRoadSetbackSqm) : '0');
  setText('ad-resarea', c.areaUnderReservationsSqm != null ? formatNumber(c.areaUnderReservationsSqm) : '0');
  setText('ad-rescount', c.reservationCount);

  // Real/inferred facts: pre-set from computed data, still user-togglable (matching
  // the reference product's own "auto-computed default, editable" pattern) — flipping
  // one doesn't feed back into any engine yet, it's just an override for this session.
  setToggle('ad-gaothan-toggle', 'ad-gaothan-label', c.fallsInGaothanKoliwadaAdivasipada, { on: 'Yes', off: 'No' });
  setToggle('ad-industrial-toggle', 'ad-industrial-label', ad.flagged.fallsInIndustrialZone.value, { on: 'Yes', off: 'No' });
  setToggle('ad-crz-toggle', 'ad-crz-label', ad.flagged.fallsInCRZ.value, { on: 'Yes', off: 'No' });
  setToggle('ad-metro-toggle', 'ad-metro-label', ad.flagged.withinMetroProximity.value, { on: 'Yes', off: 'No' });

  // Genuine gaps: no computed value exists, always start unset. Toggling them is a
  // pure manual override the user makes themselves, clearly labeled as such.
  setToggle('ad-cbd-toggle', 'ad-cbd-label', false, { on: 'Yes (manual)', off: 'No data — set manually' });
  setToggle('ad-slums-toggle', 'ad-slums-label', false, { on: 'Yes (manual)', off: 'No data — set manually' });

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

function setToggle(toggleId, labelId, checked, labelText) {
  const toggle = document.getElementById(toggleId);
  const label = document.getElementById(labelId);
  if (!toggle || !label) return;
  toggle.checked = Boolean(checked);
  label.textContent = toggle.checked ? labelText.on : labelText.off;
  toggle.onchange = () => { label.textContent = toggle.checked ? labelText.on : labelText.off; };
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
