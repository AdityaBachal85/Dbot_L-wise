import { SCHEME_STATUS } from '../types.js';

export const meta = {
  id: 'REG_33_7A',
  title: 'Regulation 33(7)(A) — Redevelopment of dilapidated/unsafe tenant-occupied buildings, Suburbs',
  regulation: '33(7)(A)',
  researchStatus: 'subject_confirmed_conditions_not_sourced',
  researchNote:
    'Subject/topic confirmed from the official DCPR 2034 table of contents. Eligibility conditions and ' +
    'the FSI formula are listed under "Open items — not yet pulled from the source text" in ' +
    'DCPR_2034_Regulation_Reference.md.pdf — genuinely not researched to primary-source standard yet.',
};

/**
 * Deliberately never returns ELIGIBLE or NOT_ELIGIBLE — see meta.researchNote.
 * @returns {import('../types.js').SchemeResult}
 */
export function evaluate(_parcelFacts = {}, _buildingFacts = {}) {
  return {
    status: SCHEME_STATUS.NOT_EVALUABLE,
    reasons: [
      {
        text:
          'Regulation 33(7)(A) eligibility conditions (what qualifies a building as "dilapidated/unsafe", ' +
          'tenant-occupancy requirements, structural condition category) and its FSI formula have not been ' +
          'pulled from primary clause text. Only the subject is confirmed so far.',
      },
    ],
    sources: [
      {
        value: null,
        source_type: 'not_yet_sourced',
        source_url_or_document: 'DCPR_2034_Regulation_Reference.md.pdf — "Open items" list',
        retrieved_at: null,
        confidence: 'unconfirmed',
      },
    ],
    data: null,
  };
}
