import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEME_STATUS } from '../src/types.js';
import * as reg33_5 from '../src/schemes/reg33_5.js';
import * as reg33_7 from '../src/schemes/reg33_7.js';
import * as reg33_7A from '../src/schemes/reg33_7A.js';
import * as reg33_7B from '../src/schemes/reg33_7B.js';

// These four regulations' eligibility conditions have not been sourced from primary DCPR clause
// text (see DCPR_2034_Regulation_Reference.md.pdf's "Open items" list). This test asserts the
// honest-gap contract holds: no matter what facts are thrown at them, they never fabricate a
// 🟢/🔴 verdict. If this test starts failing because someone added real condition logic, that's
// the signal to also update researchStatus in that scheme's meta and remove this guard.
const UNRESEARCHED_SCHEMES = [reg33_5, reg33_7, reg33_7A, reg33_7B];

const FACT_FIXTURES = [
  {},
  { zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL', roadWidthM: 12 },
  { buildingAgeYears: 40, isCessed: true, tenantOccupancyCount: 20, isSocietyRegistered: true },
];

for (const scheme of UNRESEARCHED_SCHEMES) {
  test(`${scheme.meta.id} always returns NOT_EVALUABLE, never a fabricated verdict`, () => {
    for (const facts of FACT_FIXTURES) {
      const result = scheme.evaluate(facts, facts);
      assert.equal(result.status, SCHEME_STATUS.NOT_EVALUABLE);
      assert.equal(result.data, null);
      assert.ok(result.reasons.length > 0, 'must explain why it is not evaluable');
      assert.equal(scheme.meta.researchStatus, 'subject_confirmed_conditions_not_sourced');
    }
  });
}
