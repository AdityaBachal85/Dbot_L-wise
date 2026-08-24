import { SERVICES, SR_WEB_MERCATOR } from '../config/services.js';

const DEFAULT_BATCH_SIZE = 500; // safe default; real cap comes from layer metadata when available
const DEFAULT_DELAY_MS = 150; // pacing between batches — this is a public server, not yours

/**
 * Ask a layer how big it is before committing to a download.
 * Cheap: uses returnIdsOnly, no geometry/attributes transferred.
 */
export async function estimateLayerSize(service, layerId, where = '1=1') {
  const base = SERVICES[service];
  const params = new URLSearchParams({ f: 'json', where, returnIdsOnly: 'true' });
  const res = await fetch(`${base}/${layerId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} estimating ${service}/${layerId}`);
  const data = await res.json();
  if (data.error) throw new Error(`ArcGIS error: ${data.error.message ?? JSON.stringify(data.error)}`);
  const ids = data.objectIds ?? [];
  return { count: ids.length, objectIds: ids, objectIdField: data.objectIdFieldName ?? 'OBJECTID' };
}

/**
 * Try to read the server's own maxRecordCount, so batches are sized
 * correctly instead of guessed. Falls back to DEFAULT_BATCH_SIZE if
 * the layer metadata call fails (some deployments restrict it).
 */
async function getMaxRecordCount(service, layerId) {
  try {
    const base = SERVICES[service];
    const res = await fetch(`${base}/${layerId}?f=json`);
    const data = await res.json();
    return data.maxRecordCount && data.maxRecordCount > 0 ? data.maxRecordCount : DEFAULT_BATCH_SIZE;
  } catch {
    return DEFAULT_BATCH_SIZE;
  }
}

/**
 * Download an ENTIRE layer, city-wide, no geometry filter — the correct
 * approach for reference layers (zones, reservations, roads, heritage,
 * CRZ, metro, gaothan, etc.) that exist independently of any parcel.
 *
 * Uses object-ID batching (query by explicit ID list) rather than
 * offset-based paging — more robust if records shift during a long-
 * running pull, which offset pagination can silently get wrong.
 *
 * @param {'DP'|'DD'|'AKO'|'SRA'} service
 * @param {number} layerId
 * @param {object} [opts]
 * @param {string} [opts.where] - defaults to '1=1' (everything)
 * @param {boolean} [opts.returnGeometry] - defaults to true
 * @param {number} [opts.delayMs] - pause between batches
 * @param {(progress:{done:number,total:number})=>void} [opts.onProgress]
 * @returns {Promise<{features: object[], objectIdField: string}>}
 */
export async function downloadFullLayer(service, layerId, opts = {}) {
  const {
    where = '1=1',
    returnGeometry = true,
    delayMs = DEFAULT_DELAY_MS,
    onProgress,
  } = opts;

  const base = SERVICES[service];
  const { objectIds, objectIdField } = await estimateLayerSize(service, layerId, where);
  if (objectIds.length === 0) return { features: [], objectIdField };

  const batchSize = await getMaxRecordCount(service, layerId);
  const allFeatures = [];

  for (let i = 0; i < objectIds.length; i += batchSize) {
    const batchIds = objectIds.slice(i, i + batchSize);
    const params = new URLSearchParams({
      f: 'json',
      objectIds: batchIds.join(','),
      outFields: '*',
      returnGeometry: String(returnGeometry),
      outSR: String(SR_WEB_MERCATOR),
    });

    // POST — the objectIds list is exactly what blew past MCGM's URL
    // length limit as a GET query string once batches got past a few
    // hundred IDs. Confirmed in practice: every layer under ~200
    // records worked as GET, every larger one failed.
    const res = await fetch(`${base}/${layerId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on batch starting at ${i}`);
    const data = await res.json();
    if (data.error) throw new Error(`ArcGIS error on batch at ${i}: ${data.error.message ?? JSON.stringify(data.error)}`);

    allFeatures.push(...(data.features ?? []));
    onProgress?.({ done: Math.min(i + batchSize, objectIds.length), total: objectIds.length });

    if (i + batchSize < objectIds.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { features: allFeatures, objectIdField };
}
