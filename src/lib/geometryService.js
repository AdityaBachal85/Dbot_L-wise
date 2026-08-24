import { SERVICES, SR_WEB_MERCATOR } from '../config/services.js';

/**
 * Merge multiple parcel polygons into one boundary — mirrors the
 * "Hold Ctrl/Cmd for multiple" flow captured from the LandWise UI.
 *
 * @param {object[]} geometries - array of Esri polygon geometries (rings + spatialReference)
 * @returns {Promise<object>} a single unioned Esri polygon geometry
 */
export async function unionGeometries(geometries) {
  if (!geometries.length) throw new Error('unionGeometries: need at least one geometry');
  if (geometries.length === 1) return geometries[0];

  const sr = geometries[0].spatialReference ?? { wkid: SR_WEB_MERCATOR, latestWkid: SR_WEB_MERCATOR };

  const params = new URLSearchParams({
    f: 'json',
    sr: JSON.stringify(sr),
    geometries: JSON.stringify({
      geometryType: 'esriGeometryPolygon',
      geometries,
    }),
  });

  const res = await fetch(`${SERVICES.GEOMETRY}/union?${params.toString()}`);
  if (!res.ok) throw new Error(`Geometry union failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Geometry union error: ${data.error.message ?? JSON.stringify(data.error)}`);

  // Union returns a bare geometry (rings), not wrapped in spatialReference — attach it back.
  return { ...data.geometry, spatialReference: sr };
}
