import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  notFoundKey,
  typosquatKey,
  undeclaredKey,
  buildBaseline,
  writeBaseline,
  loadBaseline,
  applyBaseline,
} from '../src/baseline.js';

const missing = [
  { name: 'left-pad', ecosystem: 'npm', exists: false },
  { name: 'flaskk', ecosystem: 'pypi', exists: false },
];
const warnings = [{ name: 'reactt', ecosystem: 'npm', similarTo: 'react', distance: 1 }];
const undeclared = [{ name: 'lodahs', ecosystem: 'npm', file: '/x/y.js' }];

test('keys are stable and case-insensitive', () => {
  assert.equal(notFoundKey({ name: 'Left-Pad', ecosystem: 'npm' }), 'not-found:npm:left-pad');
  assert.equal(typosquatKey({ name: 'Reactt', ecosystem: 'npm' }), 'typosquat:npm:reactt');
  assert.equal(undeclaredKey({ name: 'Lodahs', ecosystem: 'npm' }), 'undeclared:npm:lodahs');
});

test('buildBaseline produces the three key lists', () => {
  const b = buildBaseline(missing, warnings, undeclared);
  assert.deepEqual(b.notFound, ['not-found:npm:left-pad', 'not-found:pypi:flaskk']);
  assert.deepEqual(b.typosquats, ['typosquat:npm:reactt']);
  assert.deepEqual(b.undeclared, ['undeclared:npm:lodahs']);
});

test('writeBaseline writes a readable file with the same keys', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-base-'));
  try {
    const file = await writeBaseline(dir, missing, warnings, undeclared);
    const data = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(data.notFound, ['not-found:npm:left-pad', 'not-found:pypi:flaskk']);
    assert.deepEqual(data.typosquats, ['typosquat:npm:reactt']);
    assert.deepEqual(data.undeclared, ['undeclared:npm:lodahs']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyBaseline suppresses only findings present in the baseline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-base-'));
  try {
    await writeBaseline(dir, missing, warnings, undeclared);
    const baseline = await loadBaseline(dir);

    // New findings (not in baseline) survive.
    const newMissing = [{ name: 'brand-new-fake', ecosystem: 'npm', exists: false }];
    const newWarn = [{ name: 'vuee', ecosystem: 'npm', similarTo: 'vue', distance: 1 }];
    const newUnd = [{ name: 'totallyfake', ecosystem: 'pypi', file: '/a/b.py' }];

    const filtered = applyBaseline(
      { missing: [...missing, ...newMissing], warnings: [...warnings, ...newWarn], undeclared: [...undeclared, ...newUnd] },
      baseline,
    );

    // Old findings suppressed, new ones kept.
    assert.deepEqual(filtered.missing, newMissing);
    assert.deepEqual(filtered.warnings, newWarn);
    assert.deepEqual(filtered.undeclared, newUnd);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyBaseline is a no-op when baseline is null', () => {
  const filtered = applyBaseline({ missing, warnings, undeclared }, null);
  assert.deepEqual(filtered.missing, missing);
  assert.deepEqual(filtered.warnings, warnings);
  assert.deepEqual(filtered.undeclared, undeclared);
});

test('loadBaseline returns null when no file exists', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-base-'));
  try {
    assert.equal(await loadBaseline(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
