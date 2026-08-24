// The CTS parcel layer (DP/13) is the index everything else joins
// against, and it's the biggest single layer by far — one village
// alone returned 4,528 parcels in earlier testing. Chunking by ward
// keeps each output file a sane size and makes a failed run resumable
// (skip wards whose file already exists) instead of losing everything
// on one long unbroken pull.
//
//   node examples/downloadAllParcels.js

import { downloadFullLayer } from '../src/lib/bulkFetch.js';
import { esriFeaturesToGeoJson } from '../src/lib/esriToGeoJson.js';
import fs from 'node:fs/promises';

const OUT_DIR = 'data/parcels';

// Best-effort fallback only — run fetchWardList.js first so this reads
// the real, confirmed codes from data/wards.json instead of guessing.
const GUESSED_WARDS = [
  'A', 'B', 'C', 'D', 'E', 'F/N', 'F/S', 'G/N', 'G/S',
  'H/E', 'H/W', 'K/E', 'K/W', 'L', 'M/E', 'M/W', 'N',
  'P/N', 'P/S', 'R/C', 'R/N', 'R/S', 'S', 'T',
];

async function getWards() {
  try {
    const raw = await fs.readFile('data/wards.json', 'utf-8');
    const wards = JSON.parse(raw);
    console.log(`Using confirmed ward list from data/wards.json (${wards.length} wards).`);
    return wards;
  } catch {
    console.warn('data/wards.json not found — falling back to a GUESSED ward list.');
    console.warn('Run `node examples/fetchWardList.js` first to use the real, confirmed codes.');
    return GUESSED_WARDS;
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const WARDS = await getWards();

  for (const ward of WARDS) {
    const safeWard = ward.replace('/', '-');
    const outPath = `${OUT_DIR}/ward_${safeWard}.geojson`;

    try {
      await fs.access(outPath);
      console.log(`[skip]  Ward ${ward} — already downloaded (${outPath} exists)`);
      continue;
    } catch {
      // doesn't exist yet — proceed
    }

    console.log(`[start] Ward ${ward}`);
    try {
      const { features } = await downloadFullLayer('DP', 13, {
        where: `WARD = '${ward.replace(/'/g, "''")}'`,
        onProgress: ({ done, total }) => {
          if (total > 1000 && done % 2000 === 0) console.log(`  Ward ${ward}: ${done}/${total}`);
        },
      });
      await fs.writeFile(outPath, JSON.stringify(esriFeaturesToGeoJson(features)));
      console.log(`[done]  Ward ${ward}: ${features.length} parcels -> ${outPath}`);
    } catch (err) {
      console.error(`[FAIL]  Ward ${ward}: ${err.message} — re-run this script to retry (already-done wards are skipped)`);
    }
  }

  console.log('\nAll wards processed. Re-run this script any time to pick up wards that failed —');
  console.log('completed wards are skipped automatically.');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
