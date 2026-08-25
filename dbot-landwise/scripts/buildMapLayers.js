// Precompute city-wide, always-on map overlay layers (zones, reservations,
// roads, heritage, CRZ, airport height, metro, gaothan, admin boundaries) for
// the static GitHub Pages site. Unlike buildStaticData.js (per-parcel facts,
// O(parcels x features)), this is O(features) -- just simplify + trim each
// reference layer once and group by category. Much faster, can run alongside
// the facts precompute.
//
// Deliberately excludes AKO_1060 (134,981 per-CTS building-height points),
// AKO_6 and AKO_55 (34,431 + 26,206 utility survey/water-main features), and
// the still-unconfirmed UNKNOWN layers. Those three alone are 195,618 of the
// 237,633 total reference features -- rendering them always-on, city-wide
// would be unusable regardless of simplification, and none of them are
// planning/zoning layers in the sense a map overlay is for (AKO_1060 stays
// available per-parcel in the Additional Land Details panel). See the
// buildStaticData.js SIMPLIFY_VERTEX_THRESHOLD comment for the same category
// of finding (a handful of layers dominate cost/size disproportionately).
//
// Run from dbot-landwise/: node scripts/buildMapLayers.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simplify } from '@turf/simplify';
import { LAYERS } from '../../src/config/layers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LAYERS_DIR = path.join(REPO_ROOT, 'data', 'layers');
const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'data', 'mapLayers');

const EXCLUDED_LAYER_NAMES = new Set(['AKO_1060', 'AKO_6', 'AKO_55']);
const EXCLUDED_CATEGORIES = new Set(['CADASTRAL', 'UTILITY', 'UNKNOWN']);

// City-wide display tolerance -- coarser than buildStaticData.js's area-calc
// tolerance (~3m), since this is for visual rendering at city/ward zoom
// levels, not a precise overlap-area figure. ~15m is imperceptible at that
// zoom and cuts every polygon's vertex count, not just the extreme outliers.
const DISPLAY_SIMPLIFY_TOLERANCE_DEG = 0.00015;

// Housekeeping/audit fields present on nearly every layer that add nothing
// for a map popup -- stripped to keep the shipped payload small.
const NOISY_PROPERTY_KEYS = new Set([
  'OBJECTID', 'OBJECTID_1', 'OBJECTID_12', 'TARGET_FID', 'FINAL_OID',
  'CREATED_USER', 'CREATED_DATE', 'LAST_EDITED_USER', 'LAST_EDITED_DATE',
  'MODIFNUM', 'SHAPE.AREA', 'SHAPE.LEN', 'SHAPE_LENG', 'SHAPE_LE_1',
  'APRDOCS', 'EDIT_REMARK', 'GIS_TEAM', 'GIS_REMARK',
]);

function trimProperties(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (!NOISY_PROPERTY_KEYS.has(k) && v != null) out[k] = v;
  }
  return out;
}

function layerMetaFor(fileName) {
  const m = fileName.match(/^([A-Z]+)_(\d+)$/);
  if (!m) return null;
  const [, service, layerIdStr] = m;
  const layerId = Number(layerIdStr);
  return LAYERS.find((l) => l.service === service && l.layerId === layerId) ?? null;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(LAYERS_DIR)).filter((f) => f.endsWith('.geojson'));

  const byCategory = {};
  let totalIn = 0;
  let totalOut = 0;

  for (const file of files) {
    const name = file.replace(/\.geojson$/, '');
    if (EXCLUDED_LAYER_NAMES.has(name)) { console.log(`  skip ${name} (excluded, heavy point/utility layer)`); continue; }

    const meta = layerMetaFor(name);
    if (!meta || EXCLUDED_CATEGORIES.has(meta.category)) { console.log(`  skip ${name} (excluded category)`); continue; }

    const raw = await fs.readFile(path.join(LAYERS_DIR, file), 'utf-8');
    const { features } = JSON.parse(raw);
    totalIn += features.length;

    const bucket = (byCategory[meta.category] ??= []);
    for (const f of features) {
      if (!f.geometry) continue;
      let geometry = f.geometry;
      try {
        geometry = simplify({ type: 'Feature', properties: {}, geometry }, {
          tolerance: DISPLAY_SIMPLIFY_TOLERANCE_DEG, highQuality: false,
        }).geometry;
      } catch {
        // keep original geometry if simplify fails on a malformed feature
      }
      bucket.push({
        type: 'Feature',
        properties: { layer: name, label: meta.label, confidence: meta.confidence, ...trimProperties(f.properties) },
        geometry,
      });
      totalOut++;
    }
    console.log(`  loaded ${name} -> ${meta.category} (${features.length} features)`);
  }

  for (const [category, features] of Object.entries(byCategory)) {
    const outPath = path.join(OUT_DIR, `${category}.geojson`);
    await fs.writeFile(outPath, JSON.stringify({ type: 'FeatureCollection', features }));
    const stat = await fs.stat(outPath);
    console.log(`wrote ${outPath} (${features.length} features, ${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  }

  console.log(`\nDone. ${totalOut} features across ${Object.keys(byCategory).length} categories (${totalIn - totalOut === 0 ? 'none' : totalIn - totalOut} dropped for missing geometry).`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
