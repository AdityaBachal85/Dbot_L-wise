// Loads everything downloaded by bulkDownloadAll.js and downloadAllParcels.js
// into PostGIS. Idempotent — safe to re-run; existing rows get upserted,
// not duplicated (matched on service+layerId+sourceObjectId for reference
// layers, cts+village+ward for parcels).
//
// Requires DATABASE_URL env var, e.g.:
//   DATABASE_URL=postgres://user:pass@host:5432/dbname node scripts/loadToPostgres.js
//
// Point this at ai.dbot.in's existing Postgres instance rather than
// standing up a new database — this only adds two new tables to it.

import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LAYERS } from '../src/config/layers.js';

const { Client } = pg;
const LAYERS_DIR = 'data/layers';
const PARCELS_DIR = 'data/parcels';
const BATCH_SIZE = 500;

async function loadSchema(client) {
  const schemaSql = await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf-8');
  await client.query(schemaSql);
  console.log('Schema ready (dp_parcels, dp_layer_features).');
}

/**
 * Normalize a GeoJSON Polygon/MultiPolygon geometry to MultiPolygon,
 * matching the column type — ST_Multi() handles this in SQL, this just
 * passes the geometry through as a JSON string for ST_GeomFromGeoJSON.
 */
function geomParam(geometry) {
  return geometry ? JSON.stringify(geometry) : null;
}

async function loadReferenceLayers(client) {
  const targets = LAYERS.filter((l) => l.category !== 'UNKNOWN' && l.layerId !== 13);
  let totalLoaded = 0;

  for (const layer of targets) {
    const filePath = path.join(LAYERS_DIR, `${layer.service}_${layer.layerId}.geojson`);
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch {
      console.log(`[skip]  ${layer.service}/${layer.layerId} (${layer.label}) — file not found: ${filePath}`);
      continue;
    }

    const { features } = JSON.parse(raw);
    if (!features?.length) {
      console.log(`[empty] ${layer.service}/${layer.layerId} (${layer.label}) — 0 features`);
      continue;
    }

    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);
      const values = [];
      const rows = batch.map((f, j) => {
        const base = j * 7;
        values.push(
          layer.service,
          layer.layerId,
          layer.category,
          layer.label,
          f.properties?.OBJECTID ?? f.properties?.OBJECTID_1 ?? null,
          JSON.stringify(f.properties ?? {}),
          geomParam(f.geometry),
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${base + 7}),4326)))`;
      });

      await client.query(
        `INSERT INTO dp_layer_features (service, layer_id, category, label, source_objectid, attributes, geom)
         VALUES ${rows.join(',')}
         ON CONFLICT (service, layer_id, source_objectid)
         DO UPDATE SET attributes = EXCLUDED.attributes, geom = EXCLUDED.geom`,
        values,
      );
    }

    totalLoaded += features.length;
    console.log(`[done]  ${layer.service}/${layer.layerId} (${layer.label}): ${features.length} features loaded`);
  }

  console.log(`\nReference layers total: ${totalLoaded} features loaded into dp_layer_features.`);
}

async function loadParcels(client) {
  let files;
  try {
    files = (await fs.readdir(PARCELS_DIR)).filter((f) => f.endsWith('.geojson'));
  } catch {
    console.log(`[skip]  No ${PARCELS_DIR} directory found — run downloadAllParcels.js first.`);
    return;
  }

  let totalLoaded = 0;
  for (const file of files) {
    const raw = await fs.readFile(path.join(PARCELS_DIR, file), 'utf-8');
    const { features } = JSON.parse(raw);
    if (!features?.length) continue;

    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE);
      const values = [];
      const rows = batch.map((f, j) => {
        const base = j * 5;
        values.push(
          f.properties?.CTS_CS_NO ?? null,
          f.properties?.WARD ?? null,
          f.properties?.VILLAGE ?? null,
          f.properties?.TYPE ?? null,
          geomParam(f.geometry),
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${base + 5}),4326)))`;
      });

      await client.query(
        `INSERT INTO dp_parcels (cts_cs_no, ward, village, type, geom)
         VALUES ${rows.join(',')}
         ON CONFLICT (cts_cs_no, village, ward)
         DO UPDATE SET type = EXCLUDED.type, geom = EXCLUDED.geom`,
        values,
      );
    }

    totalLoaded += features.length;
    console.log(`[done]  ${file}: ${features.length} parcels loaded`);
  }

  console.log(`\nParcels total: ${totalLoaded} loaded into dp_parcels.`);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Set DATABASE_URL first, e.g.:');
    console.error('  DATABASE_URL=postgres://user:pass@host:5432/dbname node scripts/loadToPostgres.js');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await loadSchema(client);
    await loadReferenceLayers(client);
    await loadParcels(client);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
