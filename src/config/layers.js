/**
 * MCGM layer dictionary.
 *
 * Grounded in the actual query-response capture against test parcel
 * CTS 1/1061, Bhuleshwar, Ward C (see MCGM_DP2034_Layer_Dictionary.md).
 * `confidence` is honest, not decorative — "low" entries returned only
 * OBJECTID + audit fields with no distinguishing data yet.
 *
 * This is the ONE place to edit as more layers get confirmed. Nothing
 * downstream should hardcode a layer id.
 *
 * fetchInBattery: false means "known, but skip in the default fact-sheet
 * fetch" — e.g. still-unknown layers, or layers that need a WHERE clause
 * (like the CBD/MIDC split tests) that isn't meaningful for a generic
 * parcel lookup.
 */

export const LAYERS = [
  // ---- Cadastral & Administrative ----------------------------------
  { service: 'DP', layerId: 13, category: 'CADASTRAL', label: 'CTS parcel boundary',
    confidence: 'confirmed', fetchInBattery: false /* handled by ctsSearch.js directly */ },
  { service: 'DP', layerId: 10, category: 'ADMIN', label: 'Ward boundary',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'DP', layerId: 0, category: 'ZONE', label: 'DP Zone',
    confidence: 'high', fetchInBattery: true },
  { service: 'DP', layerId: 74, category: 'ADMIN', label: 'Island City / Suburb classification',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'DP', layerId: 72, category: 'ADMIN', label: 'MBPT Boundary (Mumbai Port Trust)',
    confidence: 'confirmed', fetchInBattery: true },

  // ---- Reservations & Designations ----------------------------------
  { service: 'DP', layerId: 46, category: 'RESERVATION', label: 'Reservations',
    confidence: 'high', fetchInBattery: true },
  { service: 'DP', layerId: 47, category: 'DESIGNATION', label: 'Land-use designations',
    confidence: 'high', fetchInBattery: true },
  { service: 'DP', layerId: 52, category: 'RESERVATION', label: 'Reservation / amenity by authority',
    confidence: 'high', fetchInBattery: true },
  { service: 'DP', layerId: 85, category: 'RESERVATION', label: 'Reservation relocation / TDR-AR tracking',
    confidence: 'high', fetchInBattery: true },
  { service: 'DP', layerId: 60, category: 'RESERVATION', label: 'Modified reservation (post-amendment)',
    confidence: 'medium', fetchInBattery: true },
  { service: 'DP', layerId: 61, category: 'DESIGNATION', label: 'Modified designation (post-amendment)',
    confidence: 'medium', fetchInBattery: true },
  { service: 'DD', layerId: 34, category: 'RESERVATION', label: 'Reservation history / sanction tracking',
    confidence: 'high', fetchInBattery: true },
  { service: 'DP', layerId: 92, category: 'RESERVATION', label: 'DP provision corrections',
    confidence: 'medium', fetchInBattery: true },
  { service: 'DP', layerId: 83, category: 'RESERVATION', label: 'DP sanction / gazette notification',
    confidence: 'medium', fetchInBattery: true },

  // ---- Roads --------------------------------------------------------
  { service: 'DP', layerId: 44, category: 'ROAD', label: 'Existing road',
    confidence: 'confirmed', fetchInBattery: true, bufferMeters: 0.5 },
  { service: 'DP', layerId: 45, category: 'ROAD', label: 'Proposed / DP road (widening)',
    confidence: 'high', fetchInBattery: true, bufferMeters: 0.5 },
  { service: 'DP', layerId: 193, category: 'ROAD', label: 'Regular Line (RL) road width',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'DP', layerId: 194, category: 'ROAD', label: 'Regular Line (RL) road width (variant)',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'DP', layerId: 81, category: 'ROAD', label: 'Approved private road / layout',
    confidence: 'medium', fetchInBattery: true },

  // ---- Heritage -------------------------------------------------------
  { service: 'DP', layerId: 77, category: 'HERITAGE', label: 'Heritage building',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'DP', layerId: 78, category: 'HERITAGE', label: 'Heritage precinct',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'DP', layerId: 79, category: 'HERITAGE', label: 'Heritage buffer',
    confidence: 'confirmed', fetchInBattery: true },

  // ---- Coastal / CRZ ---------------------------------------------------
  { service: 'DP', layerId: 66, category: 'CRZ', label: 'Coastal / CRZ buffer',
    confidence: 'medium', fetchInBattery: true },

  // ---- Height restrictions ----------------------------------------------
  { service: 'DD', layerId: 43, category: 'HEIGHT', label: 'AAI airport height NOC',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'AKO', layerId: 1060, category: 'HEIGHT', label: 'Per-CTS building height / MSL datum',
    confidence: 'high', fetchInBattery: true },

  // ---- Metro / transit -----------------------------------------------
  { service: 'DP', layerId: 34, category: 'METRO', label: 'Metro corridor (by line)',
    confidence: 'high', fetchInBattery: true, bufferMeters: 50 },
  { service: 'DP', layerId: 1550, category: 'METRO', label: 'Metro network (index)',
    confidence: 'medium', fetchInBattery: true },
  // Station points (needed for the "within 500m of metro station" fact) not yet found.

  // ---- Gaothan / Koliwada / Adivasipada ---------------------------------
  { service: 'AKO', layerId: 1022, category: 'GAOTHAN', label: 'Gaothan boundary',
    confidence: 'confirmed', fetchInBattery: true },
  { service: 'AKO', layerId: 1023, category: 'GAOTHAN', label: 'Koliwada / Adivasipada boundary',
    confidence: 'high', fetchInBattery: true },
  { service: 'DD', layerId: 23, category: 'GAOTHAN', label: 'TPS (Town Planning Scheme)',
    confidence: 'confirmed', fetchInBattery: true },

  // ---- Utilities (engineering due-diligence, not DCPR/FSI-relevant) -----
  { service: 'AKO', layerId: 6, category: 'UTILITY', label: 'Ground-level survey node (possible elevation source)',
    confidence: 'low', fetchInBattery: false },
  { service: 'AKO', layerId: 55, category: 'UTILITY', label: 'Water supply main',
    confidence: 'high', fetchInBattery: false },

  // ---- Still unconfirmed — kept for completeness, excluded by default ---
  ...[16, 24, 49, 50, 64, 68, 70, 82, 197, 1149, 1504, 2259, 2250].map((layerId) => ({
    service: 'DP', layerId, category: 'UNKNOWN', label: `Unconfirmed layer ${layerId}`,
    confidence: 'unconfirmed', fetchInBattery: false,
  })),
];

export function layersByCategory(category) {
  return LAYERS.filter((l) => l.category === category);
}

export function batteryLayers() {
  return LAYERS.filter((l) => l.fetchInBattery);
}
