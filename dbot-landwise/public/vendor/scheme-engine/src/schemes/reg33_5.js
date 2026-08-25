import { SCHEME_STATUS } from '../types.js';

export const meta = {
  id: 'REG_33_5',
  title: 'Regulation 33(5) — MHADA scheme redevelopment',
  regulation: '33(5)',
  researchStatus: 'subject_confirmed_conditions_not_sourced',
  researchNote:
    'Not present at all in DCPR_2034_Regulation_Reference.md.pdf\'s "Regulation number → actual subject" ' +
    'table (which runs 30, 32, 33(7), 33(7)(A), 33(7)(B), 33(9), 33(10), 33(11), 33(12), 33(18), 33(20), ' +
    '33(23) — no 33(5) entry). The brief lists this as "confirmed," but the regulation reference file does ' +
    'not back that up. Treat as unresearched until the primary clause text is located and pulled.',
};

/**
 * Deliberately never returns ELIGIBLE or NOT_ELIGIBLE — no primary source text has been pulled for
 * this regulation's eligibility conditions, so there is nothing deterministic to evaluate against.
 * See meta.researchNote.
 *
 * @returns {import('../types.js').SchemeResult}
 */
export function evaluate(_parcelFacts = {}, _buildingFacts = {}) {
  return {
    status: SCHEME_STATUS.NOT_EVALUABLE,
    reasons: [
      {
        text:
          'Regulation 33(5) eligibility conditions and FSI formula have not been sourced from primary ' +
          'clause text. This regulation does not even appear in the reference document\'s confirmed table ' +
          'of contents — it needs to be located in the sanctioned DCPR 2034 document before any verdict ' +
          'can be computed.',
      },
    ],
    sources: [
      {
        value: null,
        source_type: 'not_yet_sourced',
        source_url_or_document: 'DCPR_2034_Regulation_Reference.md.pdf — not present in the confirmed TOC',
        retrieved_at: null,
        confidence: 'unconfirmed',
      },
    ],
    data: null,
  };
}
