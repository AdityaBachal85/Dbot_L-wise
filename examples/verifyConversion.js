// The check that actually matters: does the CONVERTED GeoJSON output
// have real geometry for the polyline/point layers, or is it still
// null? checkGeometryTypes.js checks the raw Esri input, which never
// changes regardless of converter bugs — this checks the output of
// esriToGeoJson.js, which is what the fix actually touched.
//
//   node examples/verifyConversion.js

import fs from 'node:fs/promises';

const LAYERS_TO_CHECK = ['DP_193', 'DP_194', 'DP_34', 'AKO_55', 'AKO_6'];

async function main() {
  for (const name of LAYERS_TO_CHECK) {
    const path = `data/layers/${name}.geojson`;
    let data;
    try {
      data = JSON.parse(await fs.readFile(path, 'utf-8'));
    } catch {
      console.log(`${name}: file not found (${path})`);
      continue;
    }

    const total = data.features.length;
    const withGeometry = data.features.filter((f) => f.geometry !== null).length;
    const sampleType = data.features.find((f) => f.geometry)?.geometry?.type ?? 'none found';

    console.log(`${name}: ${withGeometry}/${total} features have real geometry (sample type: ${sampleType})`);
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
