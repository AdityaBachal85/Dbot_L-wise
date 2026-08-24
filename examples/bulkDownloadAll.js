// Downloads every CONFIRMED reference layer in full — city-wide, no
// parcel filter. This is the "get all the data" script for everything
// that isn't the CTS parcel index itself (see downloadAllParcels.js
// for that, since it needs ward-by-ward chunking).
//
// Run estimateAllLayers.js first so you know what you're committing to.
//
//   node examples/bulkDownloadAll.js

import { LAYERS } from '../src/config/layers.js';
import { downloadFullLayer } from '../src/lib/bulkFetch.js';
import { esriFeaturesToGeoJson } from '../src/lib/esriToGeoJson.js';
import fs from 'node:fs/promises';

const OUT_DIR = 'data/layers';
const CONCURRENCY = 3; // lower than the fact-sheet battery — these are much bigger pulls

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const targets = LAYERS.filter((l) => l.category !== 'UNKNOWN' && l.layerId !== 13); // CTS handled separately

  let active = 0;
  let idx = 0;
  const results = [];

  async function runNext() {
    const i = idx++;
    if (i >= targets.length) return;
    const layer = targets[i];
    active++;
    const label = `${layer.service}/${layer.layerId} (${layer.label})`;
    const rawPath = `${OUT_DIR}/${layer.service}_${layer.layerId}.esri.json`;
    const geoPath = `${OUT_DIR}/${layer.service}_${layer.layerId}.geojson`;

    try {
      await fs.access(geoPath);
      console.log(`[skip]  ${label} — already downloaded (${geoPath} exists)`);
      results.push({ layer: label, ok: true, skipped: true });
      active--;
      return runNext();
    } catch {
      // doesn't exist yet — proceed
    }

    try {
      console.log(`[start] ${label}`);
      const { features } = await downloadFullLayer(layer.service, layer.layerId, {
        onProgress: ({ done, total }) => {
          if (total > 500 && done % 2000 === 0) console.log(`  ${label}: ${done}/${total}`);
        },
      });

      await fs.writeFile(rawPath, JSON.stringify(features));
      await fs.writeFile(geoPath, JSON.stringify(esriFeaturesToGeoJson(features)));

      console.log(`[done]  ${label}: ${features.length} features -> ${geoPath}`);
      results.push({ layer: label, count: features.length, ok: true });
    } catch (err) {
      console.error(`[FAIL]  ${label}: ${err.message}`);
      results.push({ layer: label, error: err.message, ok: false });
    } finally {
      active--;
    }
    return runNext();
  }

  const runners = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, runNext);
  await Promise.all(runners);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} layers downloaded successfully.`);
  if (failed.length) {
    console.log('Failed layers (re-run individually, or check if they need a WHERE clause):');
    failed.forEach((f) => console.log(`  - ${f.layer}: ${f.error}`));
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
