import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, findTyposquats } from '../src/typosquat.js';

test('levenshtein: identical strings are distance 0', () => {
  assert.equal(levenshtein('react', 'react'), 0);
});

test('levenshtein: one substitution is distance 1', () => {
  assert.equal(levenshtein('react', 'rect'), 1);
});

test('levenshtein: one insertion is distance 1', () => {
  assert.equal(levenshtein('react', 'reactt'), 1);
});

test('levenshtein: one deletion is distance 1', () => {
  assert.equal(levenshtein('react', 'reac'), 1);
});

test('levenshtein: empty string', () => {
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('levenshtein: distance 2 for two edits', () => {
  assert.equal(levenshtein('lodash', 'lodahs'), 2);
});

test('findTyposquats: reactt is similar to react', async () => {
  const matches = await findTyposquats('reactt', 'npm');
  assert.ok(matches.length >= 1, 'expected at least one match');
  assert.equal(matches[0].name, 'react');
  assert.equal(matches[0].distance, 1);
});

test('findTyposquats: express is a normal package and is not flagged', async () => {
  const matches = await findTyposquats('express', 'npm');
  assert.deepEqual(matches, []);
});

test('findTyposquats: a real top package (react) is never flagged', async () => {
  const matches = await findTyposquats('react', 'npm');
  assert.deepEqual(matches, []);
});

test('findTyposquats: short names only report distance 1', async () => {
  // "red" (3 chars) is within distance 2 of several names but must not be
  // flagged at distance 2; it should only match at distance 1.
  const matches = await findTyposquats('red', 'npm');
  for (const m of matches) assert.equal(m.distance, 1);
});

test('findTyposquats: pypi name similar to flask is caught', async () => {
  const matches = await findTyposquats('flsk', 'pypi');
  const names = matches.map((m) => m.name);
  assert.ok(names.includes('flask'), `expected flask in ${JSON.stringify(names)}`);
});

test('findTyposquats: unknown ecosystem returns no matches', async () => {
  const matches = await findTyposquats('reactt', 'crates');
  assert.deepEqual(matches, []);
});
