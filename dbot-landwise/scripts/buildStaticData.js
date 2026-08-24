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
import { LAYERS } from '../../src/config/layers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LAYERS_DIR = path.join(REPO_ROOT, 'data', 'layers');
const PARCELS_DIR = path.join(REPO_ROOT, 'data', 'parcels');
const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

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
    const grid = buildGridIndex(withBbox);
    layers.push({ name, meta, features: withBbox, grid });
    console.log(`  loaded ${name}: ${withBbox.length} features, ${grid.size} grid cells`);
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
        hits.push({
          layer: layer.name,
          category: layer.meta.category,
          label: layer.meta.label,
          confidence: layer.meta.confidence,
          properties: feature.properties,
        });
      }
    }
  }
  return hits;
}

function buildFacts(parcel, hits) {
  const areaSqm = Math.round(turfArea(parcel) * 100) / 100;
  const avgWidth = computeAvgWidth(parcel, areaSqm);

  const zoneHit = hits.find((h) => h.layer === 'DP_0');
  const islandCityHit = hits.find((h) => h.layer === 'DP_74');

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
    geometry: parcel.geometry,
    allIntersectingFeatures: hits,
  };
}

async function processWard(wardFile, layers) {
  const wardCode = wardFile.replace(/^ward_/, '').replace(/\.geojson$/, '');
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
  const outPath = path.join(OUT_DIR, 'facts', `ward_${wardCode.replace('/', '-')}.json`);
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
