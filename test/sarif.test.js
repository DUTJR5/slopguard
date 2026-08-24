import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSarif } from '../src/sarif.js';

test('toSarif returns a valid SARIF 2.1.0 skeleton', () => {
  const doc = toSarif([], []);
  assert.equal(doc.version, '2.1.0');
  assert.equal(doc.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
  assert.equal(doc.runs.length, 1);
  const driver = doc.runs[0].tool.driver;
  assert.equal(driver.name, 'slopguard');
  assert.equal(driver.version, '0.1.0');
  assert.equal(driver.rules.length, 2);
  assert.deepEqual(
    driver.rules.map((r) => r.id).sort(),
    ['slopguard/not-found-in-registry', 'slopguard/possible-typosquat'].sort(),
  );
  assert.deepEqual(doc.runs[0].results, []);
});

test('toSarif maps a missing package to a not-found result', () => {
  const doc = toSarif([{ name: 'left-padz', ecosystem: 'npm', exists: false }], []);
  const results = doc.runs[0].results;
  assert.equal(results.length, 1);
  assert.equal(results[0].ruleId, 'slopguard/not-found-in-registry');
  assert.equal(results[0].level, 'error');
  assert.match(results[0].message.text, /left-padz/);
});

test('toSarif maps a typo warning to a typosquat result', () => {
  const doc = toSarif([], [{ name: 'reactt', ecosystem: 'npm', similarTo: 'react', distance: 1 }]);
  const results = doc.runs[0].results;
  assert.equal(results.length, 1);
  assert.equal(results[0].ruleId, 'slopguard/possible-typosquat');
  assert.equal(results[0].level, 'warning');
  assert.match(results[0].message.text, /reactt/);
  assert.match(results[0].message.text, /react/);
});

test('toSarif skips packages that exist (exists === true)', () => {
  const doc = toSarif([{ name: 'react', ecosystem: 'npm', exists: true }], []);
  assert.deepEqual(doc.runs[0].results, []);
});

test('toSarif combines missing packages and typosquat warnings', () => {
  const doc = toSarif(
    [{ name: 'novrpkg', ecosystem: 'npm', exists: false }],
    [{ name: 'flaskk', ecosystem: 'pypi', similarTo: 'flask', distance: 1 }],
  );
  const results = doc.runs[0].results;
  assert.equal(results.length, 2);
  const ruleIds = results.map((r) => r.ruleId).sort();
  assert.deepEqual(ruleIds, ['slopguard/not-found-in-registry', 'slopguard/possible-typosquat']);
});
