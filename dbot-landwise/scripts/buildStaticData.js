// Precompute step for the GitHub Pages static build. GitHub Pages can only serve
// static files — no Express server, and it does NOT run Git LFS (data/layers/*
// would show up as 131-byte pointer stubs, not real geometry). So instead of
// doing the spatial join live per-request the way server/dataStore.js does, this
// runs it once, offline, for every one of the 135,342 parcels against all 31
// reference layers, and writes the results to public/data/facts/ward_X.json.
//
// Run from dbot-landwise/: node scripts/buildStaticData.js [wardCode]
// (optional wardCode arg processes just one ward — useful for a timing/size
// test before committing to the full run.)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { area as turfArea } from '@turf/area';
import { bbox } from '@turf/bbox';
import { booleanIntersects } from '@turf/boolean-intersects';
import { intersect } from '@turf/intersect';
import { simplify } from '@turf/simplify';
import { featureCollection } from '@turf/helpers';
import { LAYERS } from '../../src/config/layers.js';

// A handful of ROAD-layer features (DP/44 "existing road") represent an entire
// ward's road network as ONE polygon with 20,000-42,000 vertices — measured
// directly against the real downloaded data, not assumed. @turf/intersect
// (polygon clipping) on a feature that size, run against every parcel whose
// bbox falls in that ward (i.e. nearly every parcel, since the feature's own
// bbox spans the whole ward), made the full-city run balloon from an estimated
// ~2.5h to ~16h in testing. Reservation-layer geometry never gets this large
// (measured max ~1,020 vertices) — this simplification only fires for the
// small number of genuinely oversized road polygons.
const SIMPLIFY_VERTEX_THRESHOLD = 500;
const SIMPLIFY_TOLERANCE_DEG = 0.00003; // ~3m at Mumbai's latitude

function vertexCount(geometry) {
  // Only Polygon/MultiPolygon rings are meaningful here — computeOverlapAreaSqm
  // only ever runs @turf/intersect on those two types anyway (see the geom.type
  // check there). A LineString's `coordinates` is a flat array of [lon,lat]
  // pairs, not an array of rings — reusing the Polygon logic on it silently
  // miscounts (each pair's own length of 2 gets summed as if it were a ring),
  // which is what caused DP_193/194 (polyline road-width layers, same ROAD
  // category as the actual road polygons) to be wrongly flagged as huge.
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return 0;
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  return rings.reduce((s, r) => s + r.length, 0);
}

function simplifyIfHuge(feature) {
  if (vertexCount(feature.geometry) <= SIMPLIFY_VERTEX_THRESHOLD) return feature;
  return simplify(feature, { tolerance: SIMPLIFY_TOLERANCE_DEG, highQuality: false });
}

// Categories where the brief calls for a real geometric overlap AREA, not just a
// yes/no touch (e.g. "Area under DP Road/Setback", "Area under Reservations" —
// verified against an independent hand calculation before shipping, per the brief).
// Both layer types here are confirmed Polygon/MultiPolygon (checked against the
// actual downloaded data before wiring this in) — @turf/intersect requires that.
const OVERLAP_AREA_CATEGORIES = new Set(['ROAD', 'RESERVATION']);

function computeOverlapAreaSqm(parcelFeature, layerFeature) {
  // Use the pre-simplified geometry for the small number of oversized road
  // polygons (see simplifyIfHuge) — everything else uses its real, unsimplified
  // geometry. Hit detection (booleanIntersects, elsewhere) always uses the real
  // geometry; only this area figure is affected, and only for those features.
  const geom = layerFeature._areaGeom ?? layerFeature.geometry;
  if (geom?.type !== 'Polygon' && geom?.type !== 'MultiPolygon') return null;
  const simplifiedLayerFeature = geom === layerFeature.geometry ? layerFeature : { type: 'Feature', properties: {}, geometry: geom };
  try {
    const clipped = intersect(featureCollection([parcelFeature, simplifiedLayerFeature]));
    if (!clipped) return null;
    return Math.round(turfArea(clipped) * 100) / 100;
  } catch {
    // A handful of real-world polygons are self-intersecting or otherwise
    // malformed — turf throws rather than silently returning a wrong number.
    // null (not a guess, not a crash) is the correct behavior here.
    return null;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LAYERS_DIR = path.join(REPO_ROOT, 'data', 'layers');
const PARCELS_DIR = path.join(REPO_ROOT, 'data', 'parcels');
const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'data');

const onlyWard = process.argv[2] || null; // e.g. "B" — process one ward file for a quick test

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

// A plain per-layer linear scan (135,342 parcels x up to 237,633 features) never
// finishes in practice — AKO_1060 alone (building heights) is 134,981 features.
// Bucket each layer's features into a coarse lon/lat grid at load time so a
// parcel query only has to check the handful of features whose bbox falls in
// the same cells as the parcel's bbox, instead of the whole layer.
const CELL_SIZE_DEG = 0.005; // ~500m at Mumbai's latitude — small enough to keep buckets tight

function cellKey(col, row) {
  return `${col},${row}`;
}

function buildGridIndex(features) {
  const grid = new Map();
  for (let idx = 0; idx < features.length; idx++) {
    const [minX, minY, maxX, maxY] = features[idx]._bbox;
    const minCol = Math.floor(minX / CELL_SIZE_DEG);
    const maxCol = Math.floor(maxX / CELL_SIZE_DEG);
    const minRow = Math.floor(minY / CELL_SIZE_DEG);
    const maxRow = Math.floor(maxY / CELL_SIZE_DEG);
    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        const key = cellKey(col, row);
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(idx);
      }
    }
  }
  return grid;
}

function candidateIndexesFor(parcelBbox, grid) {
  const [minX, minY, maxX, maxY] = parcelBbox;
  const minCol = Math.floor(minX / CELL_SIZE_DEG);
  const maxCol = Math.floor(maxX / CELL_SIZE_DEG);
  const minRow = Math.floor(minY / CELL_SIZE_DEG);
  const maxRow = Math.floor(maxY / CELL_SIZE_DEG);
  const seen = new Set();
  for (let col = minCol; col <= maxCol; col++) {
    for (let row = minRow; row <= maxRow; row++) {
      const bucket = grid.get(cellKey(col, row));
      if (!bucket) continue;
      for (const idx of bucket) seen.add(idx);
    }
  }
  return seen;
}

// filenames are like "DP_0", "AKO_1060" -> map back to layers.js config for label/category/confidence
function layerMetaFor(fileName) {
  const m = fileName.match(/^([A-Z]+)_(\d+)$/);
  if (!m) return { service: fileName, layerId: null, category: 'UNKNOWN', label: fileName, confidence: 'unconfirmed' };
  const [, service, layerIdStr] = m;
  const layerId = Number(layerIdStr);
  return LAYERS.find((l) => l.service === service && l.layerId === layerId) ?? {
    service, layerId, category: 'UNKNOWN', label: fileName, confidence: 'unconfirmed',
  };
}

// Same formula as server/landFacts.js computeAvgWidth — kept in sync deliberately,
// not imported, matching this repo's existing convention (dataStore.js does the
// same for findIntersecting).
function computeAvgWidth(parcelFeature, areaSqm) {
  const [minX, minY, maxX, maxY] = bbox(parcelFeature);
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const widthM = (maxX - minX) * metersPerDegLon;
  const heightM = (maxY - minY) * metersPerDegLat;
  const longAxis = Math.max(widthM, heightM);
  if (!longAxis) return null;
  return Math.round((areaSqm / longAxis) * 100) / 100;
}

async function loadReferenceLayers() {
  const files = (await fs.readdir(LAYERS_DIR)).filter((f) => f.endsWith('.geojson'));
  const layers = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(LAYERS_DIR, file), 'utf-8');
    const { features } = JSON.parse(raw);
    const name = file.replace(/\.geojson$/, '');
    const meta = layerMetaFor(name);
    const withBbox = features.filter((f) => f.geometry).map((f) => ({ ...f, _bbox: bbox(f) }));

    let simplifiedCount = 0;
    if (OVERLAP_AREA_CATEGORIES.has(meta.category)) {
      for (const f of withBbox) {
        const simplified = simplifyIfHuge(f);
        if (simplified.geometry !== f.geometry) {
          f._areaGeom = simplified.geometry;
          simplifiedCount++;
        }
      }
    }

    const grid = buildGridIndex(withBbox);
    layers.push({ name, meta, features: withBbox, grid });
    console.log(`  loaded ${name}: ${withBbox.length} features, ${grid.size} grid cells` +
      (simplifiedCount ? `, ${simplifiedCount} simplified for area calc` : ''));
  }
  return layers;
}

function findIntersecting(parcelFeature, parcelBbox, layers) {
  const hits = [];
  for (const layer of layers) {
    const candidates = candidateIndexesFor(parcelBbox, layer.grid);
    for (const idx of candidates) {
      const feature = layer.features[idx];
      if (!bboxesOverlap(parcelBbox, feature._bbox)) continue;
      if (booleanIntersects(parcelFeature, feature)) {
        const hit = {
          layer: layer.name,
          category: layer.meta.category,
          label: layer.meta.label,
          confidence: layer.meta.confidence,
          properties: feature.properties,
        };
        if (OVERLAP_AREA_CATEGORIES.has(layer.meta.category)) {
          hit.overlapAreaSqm = computeOverlapAreaSqm(parcelFeature, feature);
        }
        hits.push(hit);
      }
    }
  }
  return hits;
}

function sumOverlapAreaSqm(hits) {
  const withArea = hits.filter((h) => h.overlapAreaSqm != null);
  if (!withArea.length) return null;
  return Math.round(withArea.reduce((s, h) => s + h.overlapAreaSqm, 0) * 100) / 100;
}

function buildFacts(parcel, hits) {
  const areaSqm = Math.round(turfArea(parcel) * 100) / 100;
  const avgWidth = computeAvgWidth(parcel, areaSqm);

  const zoneHit = hits.find((h) => h.layer === 'DP_0');
  const islandCityHit = hits.find((h) => h.layer === 'DP_74');

  const roadHits = hits.filter((h) => h.category === 'ROAD');
  const reservationHits = hits.filter((h) => h.category === 'RESERVATION');
  const heightHit = hits.find((h) => h.layer === 'DD_43'); // AAI airport height NOC — the brief's confirmed height/NOC layer
  const gaothanHit = hits.find((h) => h.layer === 'AKO_1022');
  const koliwadaHit = hits.find((h) => h.layer === 'AKO_1023');
  const crzHit = hits.find((h) => h.layer === 'DP_66');
  const metroHits = hits.filter((h) => h.category === 'METRO');
  // DP_52 ("Reservation / amenity by authority") carries a real AUTHORITY field — confirmed
  // against actual data (one feature: AUTHORITY: "MIDC", TYPE: "MIDC Boundary"). This is the
  // genuine, checkable basis for the brief's "inferred from a nearby MIDC reservation" signal —
  // not a guessed pattern-match.
  const midcReservationHit = reservationHits.find((h) => h.properties?.AUTHORITY === 'MIDC');

  return {
    location: {
      zone: islandCityHit?.properties?.SUBURB ??
        (zoneHit?.properties?.SUBURBS === 'CITY' ? 'Island City' : 'Mumbai Suburban / Extended Suburban'),
      dpZone: zoneHit?.properties?.ZONE_CODE2 ?? null,
    },
    land: {
      area: areaSqm,
      avgWidth,
      avgWidthApproximate: true,
      avgElevation: null,
      excluded: 0,
      abuttingRoad: null,
      ownership: null,
      developmentType: null,
    },
    // "Additional Land Details" — per the brief, every field labeled by actual confidence
    // rather than presented uniformly. See dbot-landwise/public/app.js for how each
    // confidence tier is rendered (with a tooltip on the flagged ones).
    additionalDetails: {
      confident: {
        heightPermittedByAAI: heightHit?.properties?.PERMISSIBL ?? null,
        areaUnderDPRoadSetbackSqm: sumOverlapAreaSqm(roadHits),
        areaUnderReservationsSqm: sumOverlapAreaSqm(reservationHits),
        reservationCount: reservationHits.length,
        fallsInGaothanKoliwadaAdivasipada: Boolean(gaothanHit || koliwadaHit),
      },
      flagged: {
        fallsInCRZ: {
          value: Boolean(crzHit),
          note: 'Only one thin CRZ buffer feature exists citywide (DP/66), no I/II/III/IV sub-classification.',
        },
        withinMetroProximity: {
          value: metroHits.length > 0,
          note: 'Corridor proximity only — metro station point data was never sourced, so this cannot check a specific distance-to-station threshold.',
        },
        fallsInIndustrialZone: {
          value: Boolean(midcReservationHit),
          note: 'Inferred from a touching/nearby MIDC-authority reservation (DP/52), not a dedicated industrial-zone layer.',
        },
      },
      gaps: {
        asrRate: null, // source identified (IGR Maharashtra eASR 2.0), not yet integrated
        cbdBoundary: null, // no source identified
        slumsOnSite: null, // SRA data found, not yet wired in
      },
    },
    geometry: parcel.geometry,
    allIntersectingFeatures: hits,
  };
}

async function processWard(wardFile, layers) {
  // wardCode must be slash-form ("F/N") to match wards.json/villages.json convention
  // used everywhere else in the app (buildFastStaticAssets.js, app.js's wardFileCode) —
  // this used to stay dash-form ("F-N") straight from the filename, which produced a
  // villages.json inconsistent with the rest of the site (caught by diffing this run's
  // output against the already-correct one from buildFastStaticAssets.js).
  const wardCode = wardFile.replace(/^ward_/, '').replace(/\.geojson$/, '').replace('-', '/');
  const outPath = path.join(OUT_DIR, 'facts', `ward_${wardCode.replace('/', '-')}.json`);

  // Resumable, same convention as examples/downloadAllParcels.js in the sibling
  // dbot-dp-engine project: this job is long enough (hours, citywide) that it can
  // legitimately get interrupted partway through — re-running should pick up
  // where it left off, not restart from ward A.
  const existing = await fs.stat(outPath).catch(() => null);
  if (existing) {
    console.log(`  skipping ward ${wardCode}: ${outPath} already exists`);
    const raw = await fs.readFile(path.join(PARCELS_DIR, wardFile), 'utf-8');
    const { features: parcels } = JSON.parse(raw);
    const villages = new Set(parcels.map((p) => p.properties.VILLAGE));
    return { wardCode, villages: [...villages], parcelCount: parcels.length };
  }

  const raw = await fs.readFile(path.join(PARCELS_DIR, wardFile), 'utf-8');
  const { features: parcels } = JSON.parse(raw);

  const factsByKey = {};
  const villages = new Set();
  const t0 = Date.now();

  for (let i = 0; i < parcels.length; i++) {
    const parcel = parcels[i];
    if (!parcel.geometry) continue;
    const village = parcel.properties.VILLAGE;
    const cts = parcel.properties.CTS_CS_NO;
    villages.add(village);

    const parcelBbox = bbox(parcel);
    const hits = findIntersecting(parcel, parcelBbox, layers);
    factsByKey[`${village}|${cts}`] = buildFacts(parcel, hits);

    if ((i + 1) % 500 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`    ward ${wardCode}: ${i + 1}/${parcels.length} parcels (${elapsed}s)`);
    }
  }

  await fs.mkdir(path.join(OUT_DIR, 'facts'), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(factsByKey));
  const stat = await fs.stat(outPath);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  wrote ${outPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB, ${parcels.length} parcels, ${elapsed}s)`);

  return { wardCode, villages: [...villages], parcelCount: parcels.length };
}

async function main() {
  console.log('Loading reference layers...');
  const layers = await loadReferenceLayers();
  const totalFeatures = layers.reduce((s, l) => s + l.features.length, 0);
  console.log(`Loaded ${layers.length} layers, ${totalFeatures} features total.\n`);

  let wardFiles = (await fs.readdir(PARCELS_DIR)).filter((f) => f.endsWith('.geojson'));
  if (onlyWard) {
    wardFiles = wardFiles.filter((f) => f === `ward_${onlyWard.replace('/', '-')}.geojson`);
    if (!wardFiles.length) throw new Error(`No parcel file found for ward "${onlyWard}"`);
  }

  const villagesIndex = [];
  let totalParcels = 0;
  for (const wardFile of wardFiles) {
    console.log(`Processing ${wardFile}...`);
    const { wardCode, villages, parcelCount } = await processWard(wardFile, layers);
    for (const village of villages) villagesIndex.push({ ward: wardCode, village });
    totalParcels += parcelCount;
  }

  if (!onlyWard) {
    await fs.writeFile(path.join(OUT_DIR, 'villages.json'), JSON.stringify(villagesIndex));
    await fs.writeFile(
      path.join(OUT_DIR, 'stats.json'),
      JSON.stringify({
        referenceLayerCount: layers.length,
        referenceFeatureCount: totalFeatures,
        wardCount: wardFiles.length,
        parcelCount: totalParcels,
        generatedAt: new Date().toISOString(),
      }),
    );
    console.log(`\nWrote villages.json (${villagesIndex.length} ward/village pairs) and stats.json`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
