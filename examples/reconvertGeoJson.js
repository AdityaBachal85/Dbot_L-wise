// Re-applies esriToGeoJson.js to already-downloaded raw data — no MCGM
// calls at all. Use this after a converter bug fix (like the ring/hole
// fix) instead of re-running the bulk downloads, since the raw .esri.json
// files already have everything needed.
//
//   node examples/reconvertGeoJson.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { esriFeaturesToGeoJson } from '../src/lib/esriToGeoJson.js';

const DIRS = ['data/layers', 'data/parcels'];

async function reconvertDir(dir) {
  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.esri.json'));
  } catch {
    return 0;
  }

  let count = 0;
  for (const file of files) {
    const rawPath = path.join(dir, file);
    const geoPath = rawPath.replace(/\.esri\.json$/, '.geojson');
    const features = JSON.parse(await fs.readFile(rawPath, 'utf-8'));
    await fs.writeFile(geoPath, JSON.stringify(esriFeaturesToGeoJson(features)));
    console.log(`  ${rawPath} -> ${geoPath} (${features.length} features)`);
    count++;
  }
  return count;
}

async function main() {
  let total = 0;
  for (const dir of DIRS) {
    console.log(`Scanning ${dir}...`);
    total += await reconvertDir(dir);
  }

  if (total === 0) {
    console.log('\nNo .esri.json files found. If this is for parcels specifically,');
    console.log('downloadAllParcels.js did not cache raw data before this script existed —');
    console.log('re-run downloadAllParcels.js directly (it now saves raw data going forward,');
    console.log('so this will only be necessary once).');
  } else {
    console.log(`\nReconverted ${total} file(s) with the fixed ring/hole logic. No network calls made.`);
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
