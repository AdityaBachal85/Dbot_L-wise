import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/schemes/reg30A.js';
import { SCHEME_STATUS } from '../src/types.js';

test('Island City R/C, road width 10m -> band 9m-<12m, permissible FSI 2.00', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL', roadWidthM: 10 });
  assert.equal(result.status, SCHEME_STATUS.ELIGIBLE);
  assert.equal(result.data.roadWidthBand, '9m to <12m');
  assert.equal(result.data.permissibleFSIBeforeFungible, 2.0);
});

test('Island City R/C, road width 30m -> top band, permissible FSI 3.00', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL', roadWidthM: 30 });
  assert.equal(result.data.roadWidthBand, '27m and above');
  assert.equal(result.data.permissibleFSIBeforeFungible, 3.0);
});

test('Island City R/C, road width 8m -> bottom band, no premium/TDR', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL', roadWidthM: 8 });
  assert.equal(result.data.roadWidthBand, 'Less than 9m');
  assert.equal(result.data.permissibleFSIBeforeFungible, 1.33);
});

test('Island City Industrial -> flat 1.00 regardless of road width', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', dpZoneUse: 'INDUSTRIAL', roadWidthM: 30 });
  assert.equal(result.status, SCHEME_STATUS.ELIGIBLE);
  assert.equal(result.data.permissibleFSIBeforeFungible, 1.0);
});

test('BARC special case -> flat 0.75, overrides zone use', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', isBARCArea: true });
  assert.equal(result.status, SCHEME_STATUS.ELIGIBLE);
  assert.equal(result.data.permissibleFSIBeforeFungible, 0.75);
});

test('Suburbs -> NOT_EVALUABLE, flags the unresolved 1.00-vs-1.08 conflict, never guesses a number', () => {
  const result = evaluate({ zoneClassification: 'SUBURBS', roadWidthM: 10 });
  assert.equal(result.status, SCHEME_STATUS.NOT_EVALUABLE);
  assert.equal(result.data, null);
  assert.match(result.reasons[0].text, /conflicting secondary sources/);
});

test('missing zoneClassification -> NOT_EVALUABLE', () => {
  const result = evaluate({});
  assert.equal(result.status, SCHEME_STATUS.NOT_EVALUABLE);
});

test('Island City, missing dpZoneUse -> NOT_EVALUABLE', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', roadWidthM: 10 });
  assert.equal(result.status, SCHEME_STATUS.NOT_EVALUABLE);
});

test('Island City R/C, missing roadWidthM -> NOT_EVALUABLE, never guesses a band', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL' });
  assert.equal(result.status, SCHEME_STATUS.NOT_EVALUABLE);
  assert.equal(result.data, null);
});

test('fungible compensatory area computed off the Zonal (Basic) FSI, not the full permissible FSI', () => {
  const result = evaluate(
    { zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL', roadWidthM: 10, areaSqm: 1000 },
  );
  // 0.35 * 1.33 (zonal only, not 2.00 permissible) * 1000 = 465.5
  assert.equal(result.data.fungibleCompensatoryAreaSqm, 465.5);
});

test('fungible area is null when plot area is not supplied', () => {
  const result = evaluate({ zoneClassification: 'ISLAND_CITY', dpZoneUse: 'RESIDENTIAL_COMMERCIAL', roadWidthM: 10 });
  assert.equal(result.data.fungibleCompensatoryAreaSqm, null);
});
