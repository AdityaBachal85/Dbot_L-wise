// Example: reproduce the full flow against the known test parcel
// (CTS 1/1061, Bhuleshwar, Ward C) and print a summary fact sheet.
//
// Run with real network access (your machine / Claude Code), not from
// a sandboxed tool — MCGM's robots.txt blocks automated fetchers, but
// a normal outbound request from here works fine.
//
//   node examples/fetchParcel.js

import { getParcelGeometry, buildFactSheet } from '../src/index.js';

const WARD = 'C';
const VILLAGE = 'BHULESHWAR';
const CTS = '1/1061';

async function main() {
  console.log(`Looking up CTS ${CTS}, ${VILLAGE}, Ward ${WARD}...`);
  const parcel = await getParcelGeometry(WARD, VILLAGE, CTS);
  if (!parcel) {
    console.error('Parcel not found.');
    process.exit(1);
  }
  console.log('Parcel found:', { cts: parcel.cts, ward: parcel.ward, village: parcel.village, type: parcel.type });

  console.log('Fetching fact sheet (this fires ~25 layer queries at concurrency 6)...');
  const factSheet = await buildFactSheet([parcel.geometry]);

  console.log('\n=== SUMMARY ===');
  for (const [category, entries] of Object.entries(factSheet.facts)) {
    const hits = entries.filter((e) => e.hit);
    console.log(`${category}: ${hits.length}/${entries.length} layers hit`);
    for (const h of hits) {
      console.log(`  - ${h.layer} (${h.service}/${h.layerId}): ${h.featureCount} feature(s)`);
    }
  }

  if (factSheet.warnings.length) {
    console.log('\nWarnings:', factSheet.warnings);
  }

  console.log('\nFull fact sheet JSON written to fact-sheet-output.json');
  const fs = await import('node:fs/promises');
  await fs.writeFile('fact-sheet-output.json', JSON.stringify(factSheet, null, 2));
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
