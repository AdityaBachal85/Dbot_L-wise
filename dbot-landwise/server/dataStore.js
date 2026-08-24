// Loads everything dbot-dp-engine already downloaded (data/layers, data/parcels)
// into memory once at server startup. This app never calls MCGM directly —
// that's the bulk-download scripts' job, run periodically as a refresh.
// This module just serves what's already on disk, fast.

import fs from 'node:fs/promises';
import path from 'node:path';
import { bbox } from '@turf/bbox';
import { booleanIntersects } from '@turf/boolean-intersects';

const LAYERS_DIR = process.env.DP_LAYERS_DIR ?? 'data/layers';
const PARCELS_DIR = process.env.DP_PARCELS_DIR ?? 'data/parcels';

let referenceLayers = []; // [{ name, features: [{...GeoJSON Feature, _bbox}] }]
let parcelsByWard = new Map(); // ward -> [{...GeoJSON Feature, _bbox}]
let parcelIndex = new Map(); // "ward|village|cts" -> feature, for fast direct lookup

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function parcelKey(ward, village, cts) {
  return `${ward}|${village}|${cts}`;
}

export async function loadAll() {
  // Reference layers (reservations, roads, heritage, zone, etc.)
  const layerFiles = (await fs.readdir(LAYERS_DIR).catch(() => [])).filter((f) => f.endsWith('.geojson'));
  referenceLayers = [];
  for (const file of layerFiles) {
    const raw = await fs.readFile(path.join(LAYERS_DIR, file), 'utf-8');
    const { features } = JSON.parse(raw);
    const withBbox = features.filter((f) => f.geometry).map((f) => ({ ...f, _bbox: bbox(f) }));
    referenceLayers.push({ name: file.replace(/\.geojson$/, ''), features: withBbox });
  }

  // Parcels, grouped by ward
  const parcelFiles = (await fs.readdir(PARCELS_DIR).catch(() => [])).filter((f) => f.endsWith('.geojson'));
  parcelsByWard = new Map();
  parcelIndex = new Map();
  for (const file of parcelFiles) {
    const raw = await fs.readFile(path.join(PARCELS_DIR, file), 'utf-8');
    const { features } = JSON.parse(raw);
    const withBbox = features.filter((f) => f.geometry).map((f) => ({ ...f, _bbox: bbox(f) }));
    for (const f of withBbox) {
      const ward = f.properties.WARD;
      if (!parcelsByWard.has(ward)) parcelsByWard.set(ward, []);
      parcelsByWard.get(ward).push(f);
      parcelIndex.set(parcelKey(f.properties.WARD, f.properties.VILLAGE, f.properties.CTS_CS_NO), f);
    }
  }

  const totalRef = referenceLayers.reduce((s, l) => s + l.features.length, 0);
  const totalParcels = [...parcelsByWard.values()].reduce((s, arr) => s + arr.length, 0);
  console.log(`Loaded ${referenceLayers.length} reference layers (${totalRef} features), ${parcelsByWard.size} wards (${totalParcels} parcels).`);
}

export function listWards() {
  return [...parcelsByWard.keys()].sort();
}

export function listVillages(ward) {
  const parcels = parcelsByWard.get(ward) ?? [];
  return [...new Set(parcels.map((p) => p.properties.VILLAGE))].sort();
}

export function listParcels(ward, village) {
  const parcels = parcelsByWard.get(ward) ?? [];
  return parcels
    .filter((p) => p.properties.VILLAGE === village)
    .map((p) => ({
      cts: p.properties.CTS_CS_NO,
      type: p.properties.TYPE,
      geometry: p.geometry,
    }));
}

export function getParcel(ward, village, cts) {
  return parcelIndex.get(parcelKey(ward, village, cts)) ?? null;
}

/** Same intersection logic as dbot-dp-engine's localSpatialLookup.js — kept
 * in sync deliberately rather than imported cross-project, since this app
 * doesn't depend on dbot-dp-engine at runtime, only on its output files. */
export function findIntersecting(parcelFeature) {
  const parcelBbox = bbox(parcelFeature);
  const hits = [];
  for (const layer of referenceLayers) {
    for (const feature of layer.features) {
      if (!bboxesOverlap(parcelBbox, feature._bbox)) continue;
      if (booleanIntersects(parcelFeature, feature)) {
        hits.push({ layer: layer.name, properties: feature.properties });
      }
    }
  }
  return hits;
}

export function stats() {
  return {
    referenceLayerCount: referenceLayers.length,
    referenceFeatureCount: referenceLayers.reduce((s, l) => s + l.features.length, 0),
    wardCount: parcelsByWard.size,
    parcelCount: [...parcelsByWard.values()].reduce((s, arr) => s + arr.length, 0),
  };
}
