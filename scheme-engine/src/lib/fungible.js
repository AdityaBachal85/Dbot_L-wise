/**
 * Fungible compensatory area — confirmed at a flat 35% rate, applied on the
 * Zonal (Basic)/Rehab FSI component specifically (not on premium or TDR),
 * per DCPR_2034_Regulation_Reference.md.pdf: "matches the 'On Zonal
 * (Basic)/Rehab FSI — 35%' line seen in the video's FSI Statement report
 * exactly." Kept separate from any one scheme's evaluator since it applies
 * generically wherever a Zonal/Rehab FSI figure exists.
 */
export const FUNGIBLE_FSI_RATE = 0.35;

/**
 * @param {number|null} zonalOrRehabFSI
 * @param {number|null} plotAreaSqm
 * @returns {number|null} extra built-up area in sq.m, or null if inputs are missing
 */
export function computeFungibleCompensatoryAreaSqm(zonalOrRehabFSI, plotAreaSqm) {
  if (zonalOrRehabFSI == null || plotAreaSqm == null) return null;
  return Math.round(zonalOrRehabFSI * plotAreaSqm * FUNGIBLE_FSI_RATE * 100) / 100;
}
