import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectDependencies } from '../src/manifests.js';

test('collectDependencies reads package.json dependencies', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^19.0.0', 'left-pad': '1.3.0' },
        devDependencies: { vitest: '^3.0.0' },
      }),
    );
    const { packages, manifests } = await collectDependencies(dir);
    assert.equal(manifests.length, 1);
    const names = packages.map((p) => p.name).sort();
    assert.deepEqual(names, ['left-pad', 'react', 'vitest']);
    assert.ok(packages.every((p) => p.ecosystem === 'npm'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectDependencies parses requirements.txt', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    await writeFile(
      path.join(dir, 'requirements.txt'),
      ['# comment', 'requests==2.32.0', 'flask[async]>=3.0 ; python_version>"3.9"', '', '-r other.txt', 'numpy'].join('\n'),
    );
    const { packages } = await collectDependencies(dir);
    const names = packages.map((p) => p.name).sort();
    assert.deepEqual(names, ['flask', 'numpy', 'requests']);
    assert.ok(packages.every((p) => p.ecosystem === 'pypi'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectDependencies ignores node_modules and dedupes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '*' } }));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(dir, 'node_modules'));
    await writeFile(path.join(dir, 'node_modules', 'package.json'), JSON.stringify({ dependencies: { evil: '*' } }));
    const { packages } = await collectDependencies(dir);
    assert.deepEqual(packages.map((p) => p.name), ['react']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
