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
let allParcelsLayer = null;

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
  const villages = await loadVillagesIndex();
  const q = query.toLowerCase();
  const matches = villages.filter((v) => v.village.toLowerCase().includes(q));
  renderSearchResults(matches.slice(0, 15));
}

function renderSearchResults(matches) {
  searchResults.innerHTML = '';
  if (!matches.length) { searchResults.classList.add('hidden'); return; }
  for (const m of matches) {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.textContent = `${m.village} (Ward ${m.ward})`;
    div.addEventListener('click', () => selectVillage(m.ward, m.village));
    searchResults.appendChild(div);
  }
  searchResults.classList.remove('hidden');
}

async function selectVillage(ward, village) {
  searchResults.classList.add('hidden');
  searchInput.value = village;
  const parcels = await loadWardParcels(ward);
  const matching = parcels.filter((p) => p.properties.VILLAGE === village);
  showParcelsOnMap(matching, ward, village);
}

function showParcelsOnMap(parcels, ward, village) {
  if (allParcelsLayer) map.removeLayer(allParcelsLayer);
  const featureCollection = {
    type: 'FeatureCollection',
    features: parcels.map((p) => ({
      type: 'Feature',
      properties: { cts: p.properties.CTS_CS_NO, ward, village },
      geometry: p.geometry,
    })),
  };
  allParcelsLayer = L.geoJSON(featureCollection, {
    style: { color: '#0b1f3a', weight: 1, fillOpacity: 0.05 },
    onEachFeature: (feature, layer) => {
      layer.on('click', () => selectParcel(feature.properties.ward, feature.properties.village, feature.properties.cts));
    },
  }).addTo(map);
  if (parcels.length) map.fitBounds(allParcelsLayer.getBounds(), { maxZoom: 17 });
}

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
  setText('ad-gaothan', c.fallsInGaothanKoliwadaAdivasipada ? 'Yes' : 'No');

  const f = ad.flagged;
  setYesNoWithTooltip('ad-crz', 'ad-crz-tip', f.fallsInCRZ);
  setYesNoWithTooltip('ad-metro', 'ad-metro-tip', f.withinMetroProximity);
  setYesNoWithTooltip('ad-industrial', 'ad-industrial-tip', f.fallsInIndustrialZone);

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

function setYesNoWithTooltip(valueId, tooltipId, flaggedField) {
  setText(valueId, flaggedField.value ? 'Yes' : 'No');
  const tip = document.getElementById(tooltipId);
  if (tip) tip.textContent = flaggedField.note;
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

const MAP_LAYER_STYLES = {
  ZONE: { color: '#5b8dd6', weight: 1, fillOpacity: 0.06 },
  RESERVATION: { color: '#e08a2b', weight: 1, fillOpacity: 0.15 },
  DESIGNATION: { color: '#9b6bd6', weight: 1, fillOpacity: 0.1 },
  ROAD: { color: '#4a4a4a', weight: 1.5, fillOpacity: 0.15 },
  HERITAGE: { color: '#a12f45', weight: 1.5, fillOpacity: 0.25 },
  CRZ: { color: '#1f9c9c', weight: 1.5, fillOpacity: 0.15, dashArray: '4 3' },
  HEIGHT: { color: '#c62828', weight: 1.5, fillOpacity: 0.03, dashArray: '2 4' },
  METRO: { color: '#2e8b3d', weight: 3, fillOpacity: 0 },
  GAOTHAN: { color: '#8a6a3a', weight: 1, fillOpacity: 0.2 },
  ADMIN: { color: '#0b1f3a', weight: 1, fillOpacity: 0, dashArray: '6 4' },
};

const MAP_LAYER_LABELS = {
  ZONE: 'Zones', RESERVATION: 'Reservations', DESIGNATION: 'Designations', ROAD: 'Roads',
  HERITAGE: 'Heritage', CRZ: 'CRZ', HEIGHT: 'Height / Airport NOC', METRO: 'Metro',
  GAOTHAN: 'Gaothan/Koliwada', ADMIN: 'Admin boundaries',
};

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
    }).addTo(map);
    layersControl.addOverlay(layer, `${MAP_LAYER_LABELS[category]} (${data.features.length})`);
  }));
}

loadMapLayers();
clearSelection();
