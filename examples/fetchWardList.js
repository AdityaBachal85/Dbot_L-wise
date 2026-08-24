// DP/10 is small (24 records, confirmed by estimateAllLayers.js) — cheap
// to pull directly rather than trusting a reconstructed guess. Run this
// once, before downloadAllParcels.js, to get the REAL ward codes.
//
//   node examples/fetchWardList.js

import { queryLayer } from '../src/lib/arcgisClient.js';
import fs from 'node:fs/promises';

async function main() {
  const data = await queryLayer('DP', 10, { outFields: 'NAME', returnGeometry: false });
  const wards = [...new Set((data.features ?? []).map((f) => f.attributes.NAME))].sort();

  console.log(`Found ${wards.length} ward codes (expected 24):`);
  console.log(wards.join(', '));

  await fs.mkdir('data', { recursive: true });
  await fs.writeFile('data/wards.json', JSON.stringify(wards, null, 2));
  console.log('\nSaved to data/wards.json — downloadAllParcels.js will use this automatically.');

  if (wards.length !== 24) {
    console.warn(`\nWARNING: expected 24 wards, got ${wards.length}. Check for nulls/duplicates`
      + ' before trusting this list — the confirmed feature count from estimateAllLayers.js was 24.');
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
