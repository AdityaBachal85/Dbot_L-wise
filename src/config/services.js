/**
 * Base ArcGIS REST service roots.
 *
 * All of these are unauthenticated public endpoints (no token/key in any
 * captured request). They are, however, gated by robots.txt for polite
 * crawlers — this module is meant to run from an environment with real
 * network access (your own machine / server), not from a sandboxed tool.
 *
 * Two hosts serve overlapping "Development_Plan_2034" data:
 *   - agsmaps.mcgm.gov.in/.../Development_Plan_2034            (no "temp" folder)
 *   - agsmaps2.mcgm.gov.in/.../agsmapstemp/Development_Plan_2034 (staging copy)
 * The confirmed layer capture in this project used the FIRST one
 * (DP below). Prefer it; treat the "temp" host as a fallback only.
 */

export const SERVICES = {
  /** Development_Plan_2034 — zoning, reservations, roads, heritage, CTS parcels (layer 13) */
  DP: 'https://agsmaps.mcgm.gov.in/server/rest/services/Development_Plan_2034/MapServer',

  /** Development_Department (agsmapstemp folder) — TPS, airport height NOC, gaothan-adjacent layers */
  DD: 'https://agsmaps2.mcgm.gov.in/server/rest/services/agsmapstemp/Development_Department/MapServer',

  /** AKO/MCGMGIS_Departments_Master_All_Layers — utilities + per-CTS height (layer 1060) + gaothan (1022/1023) */
  AKO: 'https://agsmaps2.mcgm.gov.in/server/rest/services/AKO/MCGMGIS_Departments_Master_All_Layers/MapServer',

  /** Slum Rehabilitation Authority — separate host entirely, not yet capture-verified */
  SRA: 'https://umd.nic.in/sramap/rest/services/mcgm/srmcgm/MapServer',

  /** Generic ArcGIS Server geometry utility — used for the multi-select union operation */
  GEOMETRY: 'https://agsmaps2.mcgm.gov.in/server/rest/services/Utilities/Geometry/GeometryServer',
};

/** Esri wkid for Web Mercator — what MCGM's services use natively for query geometry. */
export const SR_WEB_MERCATOR = 102100;

/** WGS84 — what Leaflet/GeoJSON consumers want for display. */
export const SR_WGS84 = 4326;
