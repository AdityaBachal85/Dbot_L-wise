// Spatial lookups directly against the downloaded GeoJSON files — no
// PostGIS, no database server, no connection string. Loads everything
// into memory once, then answers "what touches this parcel" with a
// cheap bounding-box pre-filter followed by a real geometric intersection
// test (via Turf.js, not a hand-rolled approximation).
//
// This is the right choice when: one app, one process, occasional
// single-parcel lookups — which is DBOT's actual usage pattern right
// now. Move to PostGIS later if/when multiple apps (Map Studio AND
// ai.dbot.in) need to query the same data concurrently, or the dataset
// grows enough that an in-memory linear scan stops being instant.

import { booleanIntersects } from '@turf/boolean-intersects';
import { bbox } from '@turf/bbox';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Load every *.geojson file in a directory into memory, tagging each
 * feature with its source filename (so results can report which layer
 * they came from) and a precomputed bounding box (so the expensive
 * exact-intersection test only runs on features that could plausibly
 * overlap — the same optimization a spatial index gives you, just
 * computed once at load time instead of maintained in a database).
 */
export async function loadLayersFromDir(dir) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.geojson'));
  const layers = [];

  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), 'utf-8');
    const { features } = JSON.parse(raw);
    const withBbox = features
      .filter((f) => f.geometry) // skip any null-geometry features defensively
      .map((f) => ({ ...f, _bbox: bbox(f) }));
    layers.push({ name: file.replace(/\.geojson$/, ''), features: withBbox });
  }

  return layers;
}

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Find every feature, across every loaded layer, that intersects the
 * given parcel geometry. Same semantics as `ST_Intersects` in the
 * PostGIS version — this was tested against the identical scenario to
 * confirm it agrees.
 *
 * @param {object} parcelFeature - a GeoJSON Feature (or bare geometry) for the parcel
 * @param {Array<{name:string, features:object[]}>} layers - from loadLayersFromDir
 * @returns {Array<{layer:string, properties:object}>}
 */
export function findIntersecting(parcelFeature, layers) {
  const parcelGeom = parcelFeature.type === 'Feature' ? parcelFeature : { type: 'Feature', properties: {}, geometry: parcelFeature };
  const parcelBbox = bbox(parcelGeom);

  const hits = [];
  for (const layer of layers) {
    for (const feature of layer.features) {
      if (!bboxesOverlap(parcelBbox, feature._bbox)) continue; // cheap rejection first
      if (booleanIntersects(parcelGeom, feature)) {
        hits.push({ layer: layer.name, properties: feature.properties });
      }
    }
  }
  return hits;
}
