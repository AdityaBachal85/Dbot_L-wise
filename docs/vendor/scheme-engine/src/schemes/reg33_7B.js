import { SCHEME_STATUS } from '../types.js';

export const meta = {
  id: 'REG_33_7B',
  title: 'Regulation 33(7)(B) — Additional FSI for redevelopment of ordinary (non-cessed) residential societies',
  regulation: '33(7)(B)',
  researchStatus: 'subject_confirmed_conditions_not_sourced',
  researchNote:
    'Subject/topic confirmed from the official DCPR 2034 table of contents. A partial, UNCONFIRMED recall ' +
    'exists in DCPR_2034_Regulation_Reference.md.pdf ("10 sq.m per member or 15% of authorised BUA, ' +
    'whichever is more, for societies older than 30 years") but the doc itself flags this as a partial ' +
    'recall, not the full clause text — per project convention (verify before trusting; no guessed values ' +
    'in an institutional context) this must not drive a verdict until the complete clause is sourced and ' +
    'cross-checked.',
};

/**
 * Deliberately never returns ELIGIBLE or NOT_ELIGIBLE — see meta.researchNote. The unconfirmed candidate
 * condition below is exposed for visibility only; it is intentionally NOT used in the status logic.
 */
const UNCONFIRMED_CANDIDATE_CONDITION =
  '10 sq.m per society member OR 15% of authorised BUA, whichever is more — for societies older than ' +
  '30 years. Partial recall only, not primary-sourced. Do not use for a verdict.';

/**
 * @returns {import('../types.js').SchemeResult}
 */
export function evaluate(_parcelFacts = {}, _buildingFacts = {}) {
  return {
    status: SCHEME_STATUS.NOT_EVALUABLE,
    reasons: [
      {
        text:
          'Regulation 33(7)(B) full eligibility conditions and FSI formula have not been pulled from ' +
          'primary clause text.',
      },
      { text: `Unconfirmed candidate condition on file, not used for this verdict: ${UNCONFIRMED_CANDIDATE_CONDITION}` },
    ],
    sources: [
      {
        value: null,
        source_type: 'not_yet_sourced',
        source_url_or_document: 'DCPR_2034_Regulation_Reference.md.pdf — "Open items" list (partial recall noted, unconfirmed)',
        retrieved_at: null,
        confidence: 'unconfirmed',
      },
    ],
    data: null,
  };
}
