import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './dataStore.js';
import { router as parcelsRouter } from './routes/parcels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

const app = express();
app.use(express.json());
app.use('/api', parcelsRouter);
app.use(express.static(path.join(__dirname, '..', '..', 'docs')));

async function main() {
  console.log('Loading data (from data/layers and data/parcels)...');
  await store.loadAll();
  const s = store.stats();
  if (s.parcelCount === 0) {
    console.warn('\nWARNING: 0 parcels loaded. Point DP_LAYERS_DIR / DP_PARCELS_DIR');
    console.warn('at the GeoJSON output from dbot-dp-engine (bulkDownloadAll.js /');
    console.warn('downloadAllParcels.js) — this app reads that data, it does not fetch it.\n');
  }

  app.listen(PORT, () => {
    console.log(`DBOT Land Intelligence running at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
