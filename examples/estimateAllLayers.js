// Run this FIRST, before any bulk download — it's cheap (returnIdsOnly
// only) and tells you exactly how big each layer is, so there are no
// surprises about total scope or runtime.
//
//   node examples/estimateAllLayers.js

import { LAYERS } from '../src/config/layers.js';
import { estimateLayerSize } from '../src/lib/bulkFetch.js';

async function main() {
  console.log('Layer'.padEnd(45), 'Service/ID'.padEnd(12), 'Feature count');
  console.log('-'.repeat(75));

  let total = 0;
  for (const layer of LAYERS) {
    if (layer.category === 'UNKNOWN') continue; // no point sizing what we can't use yet
    try {
      const { count } = await estimateLayerSize(layer.service, layer.layerId);
      total += count;
      console.log(layer.label.padEnd(45), `${layer.service}/${layer.layerId}`.padEnd(12), count);
    } catch (err) {
      console.log(layer.label.padEnd(45), `${layer.service}/${layer.layerId}`.padEnd(12), `ERROR: ${err.message}`);
    }
  }

  console.log('-'.repeat(75));
  console.log('Total features across all confirmed layers:', total);
  console.log('\n(DP/13, the CTS parcel layer, IS included above — it is only excluded');
  console.log(' from the per-parcel fact-sheet battery, not from this size estimate.)');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
