/**
 * Four-state verdict — never a binary yes/no. Matches the brief's Scheme
 * Engine spec: a scheme can be short on evidence without being ineligible,
 * and "not evaluable" must stay distinguishable from "not eligible."
 */
export const SCHEME_STATUS = Object.freeze({
  ELIGIBLE: 'ELIGIBLE', // 🟢 all known conditions satisfied
  POTENTIALLY_ELIGIBLE: 'POTENTIALLY_ELIGIBLE', // 🟡 some conditions satisfied, evidence missing
  NOT_ELIGIBLE: 'NOT_ELIGIBLE', // 🔴 known facts contradict the scheme
  NOT_EVALUABLE: 'NOT_EVALUABLE', // ⚪ insufficient information to say either way
});

/**
 * @typedef {Object} SourceRef
 * @property {*} value
 * @property {string} source_type - e.g. 'primary_document', 'not_yet_sourced'
 * @property {string} source_url_or_document
 * @property {string|null} retrieved_at - ISO date, or null if genuinely unknown (never guessed)
 * @property {'confirmed'|'high'|'medium'|'low'|'unconfirmed'} confidence
 */

/**
 * @typedef {Object} SchemeReason
 * @property {string} text
 */

/**
 * @typedef {Object} SchemeResult
 * @property {string} status - one of SCHEME_STATUS
 * @property {SchemeReason[]} reasons
 * @property {SourceRef[]} sources
 * @property {Object|null} data - scheme-specific computed output (e.g. FSI numbers), or null
 */

/**
 * @typedef {Object} SchemeMeta
 * @property {string} id
 * @property {string} title
 * @property {string} regulation
 * @property {'confirmed'|'subject_confirmed_conditions_not_sourced'} researchStatus
 * @property {string} researchNote
 */
