const map = L.map('map', { zoomControl: true }).setView([19.076, 72.877], 12); // Mumbai default
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 19,
}).addTo(map);

let currentParcelLayer = null;
let allParcelsLayer = null;

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const panel = document.getElementById('details-panel');
const acknowledgeCheckbox = document.getElementById('acknowledge-checkbox');
const continueBtn = document.getElementById('continue-btn');

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
  acknowledgeCheckbox.checked = false;
  continueBtn.disabled = true;
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
  // Simple approach for v1: search across all wards' village lists, then
  // parcel lists, matching on substring. Fine at this data scale (135K
  // parcels held server-side, not re-fetched per keystroke) — revisit
  // with a proper index if search ever feels slow in practice.
  const wards = await fetchJson('/api/wards');
  const matches = [];
  for (const ward of wards) {
    const villages = await fetchJson(`/api/villages?ward=${encodeURIComponent(ward)}`);
    for (const village of villages) {
      if (village.toLowerCase().includes(query.toLowerCase())) {
        matches.push({ type: 'village', ward, village });
      }
    }
  }
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
  const parcels = await fetchJson(`/api/parcels?ward=${encodeURIComponent(ward)}&village=${encodeURIComponent(village)}`);
  showParcelsOnMap(parcels, ward, village);
}

function showParcelsOnMap(parcels, ward, village) {
  if (allParcelsLayer) map.removeLayer(allParcelsLayer);
  const featureCollection = {
    type: 'FeatureCollection',
    features: parcels.map((p) => ({ type: 'Feature', properties: { cts: p.cts, ward, village }, geometry: p.geometry })),
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
  const details = await fetchJson(`/api/parcel/${encodeURIComponent(ward)}/${encodeURIComponent(village)}/${encodeURIComponent(cts)}`);
  populatePanel(details);

  if (currentParcelLayer) map.removeLayer(currentParcelLayer);
  currentParcelLayer = L.geoJSON(details.geometry, { className: 'parcel-highlight' }).addTo(map);
  map.fitBounds(currentParcelLayer.getBounds(), { maxZoom: 18, padding: [40, 40] });
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
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

clearSelection();
