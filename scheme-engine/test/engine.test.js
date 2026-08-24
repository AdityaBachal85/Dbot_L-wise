import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScheme, evaluateAllSchemes, listSchemes, SCHEME_STATUS } from '../src/index.js';

test('listSchemes returns all 5 registered schemes with required meta fields', () => {
  const schemes = listSchemes();
  assert.equal(schemes.length, 5);
  for (const s of schemes) {
    assert.ok(s.id);
    assert.ok(s.title);
    assert.ok(s.researchStatus);
  }
});

test('evaluateScheme wraps the scheme result with schemeId/title/evaluatedAt', () => {
  const result = evaluateScheme('REG_30A', { zoneClassification: 'ISLAND_CITY', dpZoneUse: 'INDUSTRIAL' });
  assert.equal(result.schemeId, 'REG_30A');
  assert.equal(result.title, 'Regulation 30(A) — Zonal (Basic) FSI by zone and road width');
  assert.ok(result.evaluatedAt);
  assert.equal(result.status, SCHEME_STATUS.ELIGIBLE);
});

test('evaluateScheme throws on an unknown schemeId rather than silently returning nothing', () => {
  assert.throws(() => evaluateScheme('NOT_A_REAL_SCHEME', {}, {}), /unknown schemeId/);
});

test('evaluateAllSchemes runs every registered scheme against the same facts', () => {
  const results = evaluateAllSchemes(
    { zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL', roadWidthM: 15 },
    { buildingAgeYears: 45, isCessed: true },
  );
  assert.equal(results.length, 5);
  const byId = Object.fromEntries(results.map((r) => [r.schemeId, r]));
  assert.equal(byId.REG_30A.status, SCHEME_STATUS.ELIGIBLE);
  assert.equal(byId.REG_33_7.status, SCHEME_STATUS.NOT_EVALUABLE);
});
