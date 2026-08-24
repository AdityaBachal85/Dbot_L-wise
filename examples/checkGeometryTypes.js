// Reports the EXACT geometry-type breakdown per layer, using the raw
// .esri.json files (not the converted GeoJSON) — so there's no need to
// guess which layers are points/polylines and silently losing data in
// the polygon-only converter. Read-only, no network calls.
//
//   node examples/checkGeometryTypes.js

import fs from 'node:fs/promises';
import path from 'node:path';

function classify(geometry) {
  if (!geometry) return 'null';
  if (geometry.rings) return 'polygon';
  if (geometry.paths) return 'polyline';
  if (geometry.x !== undefined) return 'point';
  return 'unknown';
}

async function main() {
  const dir = 'data/layers';
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.esri.json'));

  console.log('Layer'.padEnd(14), 'polygon'.padEnd(10), 'polyline'.padEnd(10), 'point'.padEnd(8), 'null/other');
  console.log('-'.repeat(60));

  let totalPolygon = 0, totalOther = 0;

  for (const file of files.sort()) {
    const features = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8'));
    const counts = { polygon: 0, polyline: 0, point: 0, null: 0, unknown: 0 };
    for (const f of features) counts[classify(f.geometry)]++;

    totalPolygon += counts.polygon;
    totalOther += counts.polyline + counts.point + counts.null + counts.unknown;

    const name = file.replace('.esri.json', '');
    console.log(
      name.padEnd(14),
      String(counts.polygon).padEnd(10),
      String(counts.polyline).padEnd(10),
      String(counts.point).padEnd(8),
      String(counts.null + counts.unknown),
    );
  }

  console.log('-'.repeat(60));
  console.log('Total usable as polygons:', totalPolygon);
  console.log('Total NOT polygons (won\'t load via lookupParcelNoDatabase.js):', totalOther);
  console.log('\nThis is expected and mostly harmless — AKO/6 and AKO/55 were already');
  console.log('marked non-essential for the FSI/regulation engine. Worth checking,');
  console.log('though, if DP_34 or DD_34 show up here with non-polygon counts, since');
  console.log('those ARE in the regulation-relevant set.');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
