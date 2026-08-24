// Auto-computes what's genuinely derivable from geometry, and is explicit
// about what isn't. Every value here is meant to populate an EDITABLE
// field in the UI (matching the reference screenshot's pencil-icon
// pattern) — a suggested default, not a locked-in final answer.

import { area as turfArea } from '@turf/area';
import { bbox } from '@turf/bbox';

/**
 * Area in sq. m — exact, computed geodesically from the polygon. No
 * approximation here; this is a real number.
 */
export function computeArea(parcelFeature) {
  return Math.round(turfArea(parcelFeature) * 100) / 100;
}

/**
 * "Average width" has no single standard definition for an irregular
 * polygon. This approximates it as area / (long axis of the bounding
 * box) — a reasonable estimate for roughly-rectangular plots, but a
 * genuine approximation for irregular ones. Flagged as such in the
 * API response (`approximate: true`) so the UI can show it as a
 * suggestion rather than a fact, exactly like the reference screenshot's
 * editable fields.
 */
export function computeAvgWidth(parcelFeature) {
  const [minX, minY, maxX, maxY] = bbox(parcelFeature);
  // rough meters-per-degree at this latitude — fine for a same-order-of-magnitude estimate
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const widthM = (maxX - minX) * metersPerDegLon;
  const heightM = (maxY - minY) * metersPerDegLat;
  const longAxis = Math.max(widthM, heightM);
  const area = turfArea(parcelFeature);
  if (!longAxis) return null;
  return Math.round((area / longAxis) * 100) / 100;
}

/**
 * Avg Elevation — NOT computed. We identified this as an unresolved data
 * gap several turns back (AKO/6 ground-survey nodes were a low-confidence
 * candidate source, never confirmed). Returning null rather than a
 * fabricated number — the UI should show this as blank/manual-entry,
 * not silently wrong.
 */
export function computeAvgElevation() {
  return null;
}
