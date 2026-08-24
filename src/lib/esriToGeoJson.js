/**
 * Minimal Esri JSON → GeoJSON conversion. No proj4/turf dependency —
 * Web Mercator (wkid 102100/3857) to WGS84 (4326) is a standard closed-
 * form transform, not something that needs a library.
 */

const EARTH_RADIUS = 6378137.0;

function mercatorToWgs84([x, y]) {
  const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

/**
 * Signed area via the shoelace formula. In standard math orientation
 * (x right, y up), a NEGATIVE result means the ring is wound clockwise,
 * a POSITIVE result means counter-clockwise.
 */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * Esri's ring convention (per the ArcGIS REST API spec): exterior rings
 * are wound clockwise, interior rings (holes) counter-clockwise, each
 * hole immediately following the exterior ring it belongs to in the
 * array. A naive "all rings = one polygon's coordinate list" conversion
 * is wrong for any feature with a hole OR more than one disjoint part —
 * both real cases in these layers (a reservation with an excluded
 * pocket, a ward split across non-contiguous land). This groups rings
 * into their correct parts before emitting Polygon or MultiPolygon.
 */
function groupRingsIntoParts(rings) {
  const parts = []; // each entry: [exteriorRing, ...holeRings]
  for (const ring of rings) {
    const isExterior = signedArea(ring) < 0;
    if (isExterior || parts.length === 0) {
      parts.push([ring]);
    } else {
      parts[parts.length - 1].push(ring);
    }
  }
  return parts;
}

function ringsToGeoJsonGeometry(rings) {
  const parts = groupRingsIntoParts(rings);
  const project = (part) => part.map((ring) => ring.map(mercatorToWgs84));

  if (parts.length === 1) {
    return { type: 'Polygon', coordinates: project(parts[0]) };
  }
  return { type: 'MultiPolygon', coordinates: parts.map(project) };
}

/**
 * Esri polylines: an array of paths, each an array of [x,y] pairs. A
 * feature can legitimately have more than one path (a road with a gap,
 * or multiple disjoint segments sharing one attribute record) — that
 * maps to MultiLineString, a single path to LineString.
 */
function pathsToGeoJsonGeometry(paths) {
  const projected = paths.map((path) => path.map(mercatorToWgs84));
  if (projected.length === 1) {
    return { type: 'LineString', coordinates: projected[0] };
  }
  return { type: 'MultiLineString', coordinates: projected };
}

function pointToGeoJsonGeometry(point) {
  return { type: 'Point', coordinates: mercatorToWgs84([point.x, point.y]) };
}

/**
 * Convert one Esri feature (as returned by /query) to a GeoJSON Feature.
 * Handles all three geometry shapes actually present in this dataset —
 * polygons (rings), polylines (paths, e.g. road-width layers DP/193,
 * DP/194), and points (x/y, e.g. survey nodes). Previously this only
 * handled polygons and silently produced null for anything else, which
 * quietly dropped two real regulation-relevant road layers alongside
 * the genuinely non-essential utility layers.
 */
export function esriFeatureToGeoJson(feature) {
  const g = feature.geometry;
  let geometry = null;
  if (g?.rings) geometry = ringsToGeoJsonGeometry(g.rings);
  else if (g?.paths) geometry = pathsToGeoJsonGeometry(g.paths);
  else if (g?.x !== undefined && g?.y !== undefined) geometry = pointToGeoJsonGeometry(g);

  return {
    type: 'Feature',
    properties: feature.attributes ?? {},
    geometry,
  };
}

export function esriFeaturesToGeoJson(features) {
  return {
    type: 'FeatureCollection',
    features: features.map(esriFeatureToGeoJson),
  };
}