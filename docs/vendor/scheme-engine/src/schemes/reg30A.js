import { SCHEME_STATUS } from '../types.js';
import { computeFungibleCompensatoryAreaSqm } from '../lib/fungible.js';

export const meta = {
  id: 'REG_30A',
  title: 'Regulation 30(A) — Zonal (Basic) FSI by zone and road width',
  regulation: '30(A)',
  researchStatus: 'confirmed',
  researchNote:
    'Island City Residential/Commercial table, Industrial flat rate, and the BARC special case are ' +
    'confirmed from the official sanctioned DCPR 2034 document, cross-checked against 3 independent ' +
    'secondary sources. The Suburbs & Extended Suburbs table is NOT confirmed — two sources conflict ' +
    '(1.00 flat vs. 1.08 for roads under 9m) and neither has been checked against primary clause text. ' +
    'See DCPR_2034_Regulation_Reference.md.pdf.',
};

// Confirmed. Sums verified to match the reference table's own "Permissible FSI" column exactly.
const ISLAND_CITY_RESIDENTIAL_COMMERCIAL_TABLE = [
  { label: 'Less than 9m', maxRoadWidthM: 9, zonalFSI: 1.33, premiumFSI: 0, tdrFSI: 0 },
  { label: '9m to <12m', maxRoadWidthM: 12, zonalFSI: 1.33, premiumFSI: 0.5, tdrFSI: 0.17 },
  { label: '12m to <18m', maxRoadWidthM: 18, zonalFSI: 1.33, premiumFSI: 0.62, tdrFSI: 0.45 },
  { label: '18m to <27m', maxRoadWidthM: 27, zonalFSI: 1.33, premiumFSI: 0.73, tdrFSI: 0.64 },
  { label: '27m and above', maxRoadWidthM: Infinity, zonalFSI: 1.33, premiumFSI: 0.84, tdrFSI: 0.83 },
];

const ISLAND_CITY_INDUSTRIAL = { zonalFSI: 1.0, premiumFSI: 0, tdrFSI: 0 };
const BARC_SPECIAL_CASE = { zonalFSI: 0.75, premiumFSI: 0, tdrFSI: 0 }; // M Ward, R/C only, flat, confirmed

const SOURCE = {
  source_type: 'primary_document',
  source_url_or_document:
    'DCPR_2034_Regulation_Reference.md.pdf — Regulation 30(A) table (MCGM sanctioned DCPR 2034, ' +
    'portal.mcgm.gov.in, cross-checked against 3 independent secondary sources)',
  retrieved_at: null, // not recorded in the source doc — left null rather than guessed
  confidence: 'confirmed',
};

function bandFor(roadWidthM) {
  return ISLAND_CITY_RESIDENTIAL_COMMERCIAL_TABLE.find((b) => roadWidthM < b.maxRoadWidthM);
}

function buildData({ zonalFSI, premiumFSI, tdrFSI, bandLabel }, plotAreaSqm) {
  const permissibleFSI = Math.round((zonalFSI + premiumFSI + tdrFSI) * 100) / 100;
  return {
    roadWidthBand: bandLabel ?? null,
    zonalBasicFSI: zonalFSI,
    premiumFSI,
    tdrFSI,
    permissibleFSIBeforeFungible: permissibleFSI,
    fungibleCompensatoryAreaSqm: computeFungibleCompensatoryAreaSqm(zonalFSI, plotAreaSqm ?? null),
  };
}

/**
 * @param {Object} parcelFacts
 * @param {'ISLAND_CITY'|'SUBURBS'|'EXTENDED_SUBURBS'|null} parcelFacts.zoneClassification
 * @param {'RESIDENTIAL_COMMERCIAL'|'INDUSTRIAL'|null} parcelFacts.dpZoneUse
 * @param {number|null} parcelFacts.roadWidthM - abutting road width; not yet auto-derived upstream, editable input
 * @param {number|null} parcelFacts.areaSqm
 * @param {boolean|null} parcelFacts.isBARCArea - M Ward BARC-earmarked special case
 * @param {Object} _buildingFacts - unused; basic FSI does not depend on building facts
 * @returns {import('../types.js').SchemeResult}
 */
export function evaluate(parcelFacts = {}, _buildingFacts = {}) {
  const { zoneClassification, dpZoneUse, roadWidthM, areaSqm, isBARCArea } = parcelFacts;

  if (zoneClassification == null) {
    return {
      status: SCHEME_STATUS.NOT_EVALUABLE,
      reasons: [{ text: 'zoneClassification (Island City vs. Suburbs) is unknown for this parcel.' }],
      sources: [SOURCE],
      data: null,
    };
  }

  if (zoneClassification !== 'ISLAND_CITY') {
    return {
      status: SCHEME_STATUS.NOT_EVALUABLE,
      reasons: [
        {
          text:
            'Parcel is in Suburbs/Extended Suburbs. The Suburbs FSI table is not confirmed against primary ' +
            'text — two conflicting secondary sources exist (1.00 flat vs. 1.08 for roads under 9m). Do not ' +
            'compute a Suburbs basic FSI number until this is resolved.',
        },
      ],
      sources: [SOURCE],
      data: null,
    };
  }

  if (isBARCArea) {
    return {
      status: SCHEME_STATUS.ELIGIBLE,
      reasons: [{ text: 'Parcel is in the BARC-earmarked special case area (M Ward): flat 0.75 FSI, no premium/TDR.' }],
      sources: [SOURCE],
      data: buildData({ ...BARC_SPECIAL_CASE, bandLabel: 'BARC special case' }, areaSqm),
    };
  }

  if (dpZoneUse == null) {
    return {
      status: SCHEME_STATUS.NOT_EVALUABLE,
      reasons: [{ text: 'dpZoneUse (Residential/Commercial vs. Industrial) is unknown for this parcel.' }],
      sources: [SOURCE],
      data: null,
    };
  }

  if (dpZoneUse === 'INDUSTRIAL') {
    return {
      status: SCHEME_STATUS.ELIGIBLE,
      reasons: [{ text: 'Island City Industrial zone: flat 1.00 FSI, no premium or TDR component.' }],
      sources: [SOURCE],
      data: buildData({ ...ISLAND_CITY_INDUSTRIAL, bandLabel: 'Industrial (flat)' }, areaSqm),
    };
  }

  if (roadWidthM == null) {
    return {
      status: SCHEME_STATUS.NOT_EVALUABLE,
      reasons: [{ text: 'Abutting road width is not yet auto-derived for this parcel and was not supplied.' }],
      sources: [SOURCE],
      data: null,
    };
  }

  const band = bandFor(roadWidthM);
  return {
    status: SCHEME_STATUS.ELIGIBLE,
    reasons: [{ text: `Island City Residential/Commercial, road width ${roadWidthM}m falls in band "${band.label}".` }],
    sources: [SOURCE],
    data: buildData({ ...band, bandLabel: band.label }, areaSqm),
  };
}
