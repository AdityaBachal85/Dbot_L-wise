import { queryLayer, mapWithConcurrency } from './arcgisClient.js';
import { unionGeometries } from './geometryService.js';
import { batteryLayers } from '../config/layers.js';

const CONCURRENCY = 6; // be a good citizen against a public government server

/**
 * Build a Parcel Fact Sheet for one or more selected parcels.
 *
 * @param {object[]} parcelGeometries - Esri polygon geometries from ctsSearch.getParcelGeometry (or multiple, for a multi-select)
 * @returns {Promise<object>} normalized fact sheet, with raw layer responses kept for audit
 */
export async function buildFactSheet(parcelGeometries) {
  if (!parcelGeometries?.length) throw new Error('buildFactSheet: need at least one parcel geometry');

  const geometry = await unionGeometries(parcelGeometries);
  const layers = batteryLayers();

  const rawResults = await mapWithConcurrency(layers, CONCURRENCY, async (layer) => {
    const data = await queryLayer(layer.service, layer.layerId, {
      geometry,
      bufferMeters: layer.bufferMeters,
      returnGeometry: false,
    });
    return { layer, data };
  });

  return normalize(rawResults, geometry);
}

/**
 * Turn the raw per-layer responses into a structured, readable fact sheet.
 * Keeps `raw` alongside the normalized view — for a lender-facing number,
 * "we can show our work" matters as much as the number itself.
 */
function normalize(rawResults, unionedGeometry) {
  const byCategory = {};
  const errors = [];

  for (const entry of rawResults) {
    if (entry.__error) {
      errors.push(entry.__error);
      continue;
    }
    const { layer, data } = entry;
    const features = data?.features ?? [];
    const bucket = (byCategory[layer.category] ??= []);
    bucket.push({
      layer: layer.label,
      service: layer.service,
      layerId: layer.layerId,
      confidence: layer.confidence,
      hit: features.length > 0,
      featureCount: features.length,
      attributes: features.map((f) => f.attributes),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    geometry: unionedGeometry,
    facts: {
      zone: byCategory.ZONE ?? [],
      reservations: byCategory.RESERVATION ?? [],
      designations: byCategory.DESIGNATION ?? [],
      roads: byCategory.ROAD ?? [],
      heritage: byCategory.HERITAGE ?? [],
      crz: byCategory.CRZ ?? [],
      height: byCategory.HEIGHT ?? [],
      metro: byCategory.METRO ?? [],
      gaothan: byCategory.GAOTHAN ?? [],
      admin: byCategory.ADMIN ?? [],
    },
    warnings: errors,
  };
}
