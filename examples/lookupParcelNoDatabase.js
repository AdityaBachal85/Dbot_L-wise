// The no-database path: query the downloaded GeoJSON files directly.
// Run this after bulkDownloadAll.js / downloadAllParcels.js / reconvertGeoJson.js
// have already produced data/layers/*.geojson and data/parcels/*.geojson —
// no Postgres, no connection string, nothing to provision.
//
//   node examples/lookupParcelNoDatabase.js

import fs from 'node:fs/promises';
import { loadLayersFromDir, findIntersecting } from '../src/lib/localSpatialLookup.js';

const WARD = 'C';
const VILLAGE = 'BHULESHWAR';
const CTS = '1/1061';

async function main() {
  console.log('Loading all reference layers into memory...');
  const layers = await loadLayersFromDir('data/layers');
  const totalFeatures = layers.reduce((sum, l) => sum + l.features.length, 0);
  console.log(`Loaded ${layers.length} layers, ${totalFeatures} features total.\n`);

  console.log(`Finding parcel CTS ${CTS}, ${VILLAGE}, Ward ${WARD}...`);
  const wardFile = `data/parcels/ward_${WARD.replace('/', '-')}.geojson`;
  const { features: parcels } = JSON.parse(await fs.readFile(wardFile, 'utf-8'));
  const parcel = parcels.find(
    (p) => p.properties.CTS_CS_NO === CTS && p.properties.VILLAGE === VILLAGE,
  );

  if (!parcel) {
    console.error('Parcel not found in', wardFile);
    process.exit(1);
  }

  console.log('Parcel found. Checking against all layers (in-memory, no network, no database)...\n');
  const hits = findIntersecting(parcel, layers);

  if (hits.length === 0) {
    console.log('No intersecting features found.');
  } else {
    console.log(`${hits.length} intersecting feature(s):`);
    for (const hit of hits) {
      console.log(`  [${hit.layer}]`, JSON.stringify(hit.properties));
    }
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
