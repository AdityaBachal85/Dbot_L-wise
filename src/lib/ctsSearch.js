import { queryLayer } from './arcgisClient.js';

const DP = 'DP';
const CTS_LAYER = 13; // Development_Plan_2034 / MapServer / 13 — confirmed cadastral layer

/**
 * Step 1 of the cascade: list distinct villages within a ward.
 * @param {string} ward - e.g. "C"
 */
export async function listVillagesInWard(ward) {
  const data = await queryLayer(DP, CTS_LAYER, {
    where: `WARD = '${escapeSql(ward)}'`,
    outFields: 'VILLAGE',
    returnGeometry: false,
  });
  // ArcGIS distinct-values requires a server-side flag; not all deployments
  // honour it identically, so de-dupe defensively on our side too.
  const names = (data.features ?? []).map((f) => f.attributes.VILLAGE);
  return [...new Set(names)].sort();
}

/**
 * Step 2: list CTS numbers (with geometry, for map rendering/picking) in a village.
 * @param {string} ward
 * @param {string} village
 */
export async function listParcelsInVillage(ward, village) {
  const data = await queryLayer(DP, CTS_LAYER, {
    where: `VILLAGE = '${escapeSql(village)}' AND WARD = '${escapeSql(ward)}'`,
    outFields: 'CTS_CS_NO,WARD,VILLAGE,TYPE',
    returnGeometry: true,
  });
  return (data.features ?? []).map((f) => ({
    cts: f.attributes.CTS_CS_NO,
    ward: f.attributes.WARD,
    village: f.attributes.VILLAGE,
    type: f.attributes.TYPE,
    geometry: f.geometry,
  }));
}

/**
 * Step 3: fetch one specific parcel's geometry by CTS number.
 * @param {string} ward
 * @param {string} village
 * @param {string} cts - e.g. "1/1061"
 * @returns {Promise<object|null>} { cts, ward, village, geometry } or null if not found
 */
export async function getParcelGeometry(ward, village, cts) {
  const data = await queryLayer(DP, CTS_LAYER, {
    where: `CTS_CS_NO = '${escapeSql(cts)}' AND VILLAGE = '${escapeSql(village)}' AND WARD = '${escapeSql(ward)}'`,
    outFields: 'CTS_CS_NO,WARD,VILLAGE,TYPE',
    returnGeometry: true,
  });
  const f = (data.features ?? [])[0];
  if (!f) return null;
  return {
    cts: f.attributes.CTS_CS_NO,
    ward: f.attributes.WARD,
    village: f.attributes.VILLAGE,
    type: f.attributes.TYPE,
    geometry: f.geometry,
  };
}

function escapeSql(value) {
  // MCGM's service takes raw SQL-ish where clauses (confirmed from capture) —
  // this is the minimum defence against a stray quote breaking the query.
  // It is NOT a substitute for validating input server-side before this
  // module is ever exposed behind a public API.
  return String(value).replace(/'/g, "''");
}
