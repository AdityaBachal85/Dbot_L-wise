import { SCHEMES } from './schemes/registry.js';

export { SCHEME_STATUS } from './types.js';
export { FUNGIBLE_FSI_RATE, computeFungibleCompensatoryAreaSqm } from './lib/fungible.js';

/**
 * @returns {import('./types.js').SchemeMeta[]}
 */
export function listSchemes() {
  return Object.values(SCHEMES).map((s) => s.meta);
}

/**
 * Evaluate one scheme against parcel + building facts. Pure function — same inputs, same
 * output, every time. Never LLM-decided: rules decide, AI explains afterward.
 *
 * @param {string} schemeId - one of the ids returned by listSchemes()
 * @param {Object} [parcelFacts] - facts derivable from GIS (dbot-dp-engine / dbot-landwise output)
 * @param {Object} [buildingFacts] - facts that are never derivable from GIS, always user input
 * @returns {{ schemeId: string, title: string, evaluatedAt: string } & import('./types.js').SchemeResult}
 */
export function evaluateScheme(schemeId, parcelFacts = {}, buildingFacts = {}) {
  const scheme = SCHEMES[schemeId];
  if (!scheme) {
    throw new Error(`evaluateScheme: unknown schemeId "${schemeId}". Known ids: ${Object.keys(SCHEMES).join(', ')}`);
  }
  const result = scheme.evaluate(parcelFacts, buildingFacts);
  return {
    schemeId,
    title: scheme.meta.title,
    evaluatedAt: new Date().toISOString(),
    ...result,
  };
}

/**
 * Evaluate every registered scheme against the same facts — the "Scheme Comparison" view.
 * @param {Object} [parcelFacts]
 * @param {Object} [buildingFacts]
 * @returns {Array<{ schemeId: string, title: string, evaluatedAt: string } & import('./types.js').SchemeResult>}
 */
export function evaluateAllSchemes(parcelFacts = {}, buildingFacts = {}) {
  return Object.keys(SCHEMES).map((schemeId) => evaluateScheme(schemeId, parcelFacts, buildingFacts));
}
