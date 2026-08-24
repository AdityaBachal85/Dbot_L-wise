import { SERVICES, SR_WEB_MERCATOR } from '../config/services.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;

/**
 * Fetch with a hard timeout (AbortController) and a couple of retries.
 * Government GIS servers are not always fast or reliable — treat that
 * as normal, not exceptional.
 */
async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, method = 'GET', body } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const fetchOpts = { signal: controller.signal, method };
      if (body) {
        fetchOpts.body = body;
        fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      }
      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = await res.json();
      if (data && data.error) {
        throw new Error(`ArcGIS error ${data.error.code ?? ''}: ${data.error.message ?? JSON.stringify(data.error)}`);
      }
      return data;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // brief backoff before retrying
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Query one layer with a polygon spatial filter.
 *
 * @param {'DP'|'DD'|'AKO'|'SRA'} service - key into SERVICES
 * @param {number} layerId
 * @param {object} [opts]
 * @param {object} [opts.geometry] - Esri polygon geometry (wkid 102100) to intersect against. Omit for non-spatial queries.
 * @param {string} [opts.where] - SQL where clause. Defaults to '1=1' (no filter beyond geometry).
 * @param {string} [opts.spatialRel] - esriSpatialRelIntersects | Touches | Within | Contains
 * @param {number} [opts.bufferMeters] - if set, buffers the query by this distance (matches MCGM's own adjacency-tolerance pattern)
 * @param {boolean} [opts.returnGeometry]
 * @param {string} [opts.outFields] - defaults to '*'
 */
export async function queryLayer(service, layerId, opts = {}) {
  const {
    geometry,
    where = '1=1',
    spatialRel = 'esriSpatialRelIntersects',
    bufferMeters,
    returnGeometry = false,
    outFields = '*',
    outSR = SR_WEB_MERCATOR,
  } = opts;

  const base = SERVICES[service];
  if (!base) throw new Error(`Unknown service key: ${service}`);

  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields,
    returnGeometry: String(returnGeometry),
    outSR: String(outSR),
  });

  if (geometry) {
    params.set('geometry', JSON.stringify(geometry));
    params.set('geometryType', 'esriGeometryPolygon');
    params.set('inSR', String(geometry.spatialReference?.wkid ?? SR_WEB_MERCATOR));
    params.set('spatialRel', spatialRel);
  }
  if (bufferMeters) {
    params.set('distance', String(bufferMeters));
    params.set('units', 'esriSRUnit_Meter');
  }

  // POST, not GET: a WHERE clause, a complex unioned polygon, or (in
  // bulkFetch.js) a long objectIds list can all push a GET query string
  // past MCGM's server URL-length limit — confirmed in practice, where
  // every layer under ~200 records worked and every larger one failed
  // with either a 404 or an outright connection failure. POST puts the
  // same parameters in the request body instead, which isn't subject
  // to that limit. This is standard practice for ArcGIS REST queries,
  // not a workaround specific to this project.
  const url = `${base}/${layerId}/query`;
  return fetchJson(url, { method: 'POST', body: params.toString() });
}

/**
 * Run several async tasks with a concurrency cap. MCGM's servers are
 * public infrastructure, not yours — don't fire 60+ requests at once.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runNext() {
    const i = cursor++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i).catch((err) => ({ __error: err.message || String(err) }));
    return runNext();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(runners);
  return results;
}
