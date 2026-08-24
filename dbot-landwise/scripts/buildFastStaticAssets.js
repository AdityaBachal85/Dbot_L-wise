// The fast half of the static build — no spatial join, so it doesn't need to
// wait on buildStaticData.js. Produces:
//   public/data/wards.json         - copy of the root wards list
//   public/data/villages.json      - {ward, village} pairs, derived from parcel files
//   public/data/parcels/ward_*.geojson - copies of the parcel geometry files (map rendering
//                                        + per-village parcel listing on the client)
//
// Run from dbot-landwise/: node scripts/buildFastStaticAssets.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PARCELS_DIR = path.join(REPO_ROOT, 'data', 'parcels');
const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

async function main() {
  await fs.mkdir(path.join(OUT_DIR, 'parcels'), { recursive: true });

  const wards = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'data', 'wards.json'), 'utf-8'));
  await fs.writeFile(path.join(OUT_DIR, 'wards.json'), JSON.stringify(wards));

  const wardFiles = (await fs.readdir(PARCELS_DIR)).filter((f) => f.endsWith('.geojson'));
  const villagesIndex = [];

  for (const file of wardFiles) {
    const wardCode = file.replace(/^ward_/, '').replace(/\.geojson$/, '').replace('-', '/');
    const raw = await fs.readFile(path.join(PARCELS_DIR, file), 'utf-8');
    const { features } = JSON.parse(raw);
    const villages = new Set(features.map((f) => f.properties.VILLAGE));
    for (const village of villages) villagesIndex.push({ ward: wardCode, village });

    await fs.copyFile(path.join(PARCELS_DIR, file), path.join(OUT_DIR, 'parcels', file));
    console.log(`  copied ${file} (${features.length} parcels, ${villages.size} villages)`);
  }

  await fs.writeFile(path.join(OUT_DIR, 'villages.json'), JSON.stringify(villagesIndex));
  console.log(`\nWrote wards.json, villages.json (${villagesIndex.length} ward/village pairs), and ${wardFiles.length} parcel files.`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
