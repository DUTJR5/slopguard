import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  collectLockedPackages,
  parsePackageLock,
  parseYarnLock,
  parsePnpmLock,
  parsePoetryLock,
  parseGemfileLock,
  parseGoSum,
  parseCargoLock,
} from '../src/lockfiles.js';

const names = (arr) => arr.map((p) => `${p.ecosystem}:${p.name}`).sort();

test('parsePackageLock reads node_modules keys (scoped + nested)', () => {
  const json = JSON.stringify({
    packages: {
      '': { name: 'root' },
      'node_modules/react': { version: '19.0.0' },
      'node_modules/@babel/core': { version: '7.0.0' },
      'node_modules/a/node_modules/lodash': { version: '4.0.0' },
    },
  });
  // `node_modules/a` has no own entry here, only a nested lodash, so "a" is not a package.
  assert.deepEqual(names(parsePackageLock(json)), [
    'npm:@babel/core',
    'npm:lodash',
    'npm:react',
  ]);
});

test('parseYarnLock extracts descriptors (scoped + comma-separated, deduped)', () => {
  const yarn = [
    '# a comment',
    'react@^19.0.0, react@^18.0.0:',
    '  version "19.0.0"',
    '@babel/core@^7.0.0:',
    '  version "7.0.0"',
    '  resolved "https://example.com"',
    '',
  ].join('\n');
  assert.deepEqual(names(parseYarnLock(yarn)), ['npm:@babel/core', 'npm:react']);
});

test('parsePnpmLock reads packages section (scoped + not scoped)', () => {
  const lock = [
    'lockfileVersion: \'6.0\'',
    '',
    'packages:',
    '',
    '  /react@19.0.0:',
    '    resolution: {integrity: xxx}',
    '  /@babel/core@7.0.0:',
    '    resolution: {integrity: yyy}',
    '    dependencies:',
    '      \'@babel/types\': 7.0.0',
    '',
    'dependencies:',
    '  react: 19.0.0',
  ].join('\n');
  assert.deepEqual(names(parsePnpmLock(lock)), ['npm:@babel/core', 'npm:react']);
});

test('parsePoetryLock reads [[package]] name fields', () => {
  const lock = [
    '[[package]]',
    'name = "requests"',
    'version = "2.32.0"',
    '',
    '[[package]]',
    'name = "flask"',
    'version = "3.0.0"',
    '',
    '[metadata]',
    'lock-version = "2.0"',
  ].join('\n');
  assert.deepEqual(names(parsePoetryLock(lock)), ['pypi:flask', 'pypi:requests']);
});

test('parseGemfileLock reads specs (skip sub-dependencies)', () => {
  const lock = [
    'GEM',
    '  remote: https://rubygems.org/',
    '  specs:',
    '    rails (7.1.0)',
    '      activesupport (= 7.1.0)',
    '      bundler (>= 1.15.0)',
    '    rake (13.0.6)',
    '',
    'PLATFORMS',
    '  ruby',
    '',
    'DEPENDENCIES',
    '  rails',
    '  rake',
  ].join('\n');
  assert.deepEqual(names(parseGemfileLock(lock)), ['rubygems:rails', 'rubygems:rake']);
});

test('collectLockedPackages finds each format and dedupes across ecosystems', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    await writeFile(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ packages: { '': {}, 'node_modules/react': {} } }),
    );
    await writeFile(path.join(dir, 'yarn.lock'), 'react@^19.0.0:\n  version "19.0.0"\n');
    await writeFile(
      path.join(dir, 'poetry.lock'),
      '[[package]]\nname = "requests"\nversion = "2.32.0"\n',
    );
    await writeFile(
      path.join(dir, 'Gemfile.lock'),
      'GEM\n  specs:\n    rails (7.1.0)\n',
    );
    const { packages, lockfiles } = await collectLockedPackages(dir);
    // react appears in both package-lock.json and yarn.lock but must dedupe.
    assert.deepEqual(names(packages), [
      'npm:react',
      'pypi:requests',
      'rubygems:rails',
    ]);
    assert.equal(lockfiles.length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectLockedPackages ignores node_modules', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(dir, 'node_modules'));
    await writeFile(
      path.join(dir, 'node_modules', 'package-lock.json'),
      JSON.stringify({ packages: { '': {}, 'node_modules/evil': {} } }),
    );
    const { packages } = await collectLockedPackages(dir);
    assert.deepEqual(packages, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseGoSum extracts module paths (go ecosystem)', () => {
  const text = [
    '# comment line',
    'github.com/gin-gonic/gin v1.9.1 h1:abc=',
    'github.com/gin-gonic/gin v1.9.1/go.mod h1:def=',
    'github.com/spf13/cobra v1.7.0 h1:ghi=',
  ].join('\n');
  assert.deepEqual(
    parseGoSum(text).map((p) => `${p.ecosystem}:${p.name}`),
    ['go:github.com/gin-gonic/gin', 'go:github.com/spf13/cobra'],
  );
});

test('parseCargoLock extracts [[package]] names (rust ecosystem)', () => {
  const text = [
    '[[package]]',
    'name = "serde"',
    'version = "1.0.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
    '[[package]]',
    'name = "tokio"',
    'version = "1.0.0"',
    '',
    '[metadata]',
    'name = "not-a-package"',
  ].join('\n');
  assert.deepEqual(
    parseCargoLock(text).map((p) => `${p.ecosystem}:${p.name}`),
    ['rust:serde', 'rust:tokio'],
  );
});

test('collectLockedPackages reads go.sum and Cargo.lock', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-lock-'));
  try {
    await writeFile(path.join(dir, 'go.sum'), 'github.com/x/y v1.0.0 h1:z=\n');
    await writeFile(
      path.join(dir, 'Cargo.lock'),
      ['[[package]]', 'name = "serde"', 'version = "1.0.0"', '', '[[package]]', 'name = "tokio"', 'version = "1.0.0"'].join('\n'),
    );
    const { packages } = await collectLockedPackages(dir);
    const got = packages.map((p) => `${p.ecosystem}:${p.name}`).sort();
    assert.deepEqual(got, ['go:github.com/x/y', 'rust:serde', 'rust:tokio']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
