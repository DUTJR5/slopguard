import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectDependencies, parseGoMod, parseCargoToml } from '../src/manifests.js';

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

test('collectDependencies parses Gemfile (rubygems)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    await writeFile(
      path.join(dir, 'Gemfile'),
      [
        "source 'https://rubygems.org'",
        "gem 'rails'",
        "# a comment",
        "gem \"pg\"",
        "gem 'rspec', '~> 3.0'",
        'gemspec',
      ].join('\n'),
    );
    const { packages, manifests } = await collectDependencies(dir);
    assert.equal(manifests.length, 1);
    const names = packages.map((p) => p.name).sort();
    assert.deepEqual(names, ['pg', 'rails', 'rspec']);
    assert.ok(packages.every((p) => p.ecosystem === 'rubygems'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseGoMod extracts module paths from require blocks', () => {
  const text = [
    'module github.com/example/app',
    '',
    'go 1.21',
    '',
    'require (',
    '	github.com/gin-gonic/gin v1.9.1',
    '	github.com/stretchr/testify v1.8.4 // indirect',
    ')',
    '',
    'require github.com/spf13/cobra v1.7.0',
    '',
    'exclude github.com/old/pkg v1.0.0',
    '',
    'replace github.com/x/y => ./local',
  ].join('\n');
  assert.deepEqual(parseGoMod(text).sort(), [
    'github.com/gin-gonic/gin',
    'github.com/spf13/cobra',
    'github.com/stretchr/testify',
  ]);
});

test('collectDependencies reads go.mod (go ecosystem)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    await writeFile(
      path.join(dir, 'go.mod'),
      ['module example.com/app', '', 'go 1.21', '', 'require (', '	github.com/gin-gonic/gin v1.9.1', ')'].join('\n'),
    );
    const { packages } = await collectDependencies(dir);
    assert.deepEqual(packages.map((p) => p.name), ['github.com/gin-gonic/gin']);
    assert.ok(packages.every((p) => p.ecosystem === 'go'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseCargoToml extracts [dependencies] and [dev-dependencies] keys and sub-tables', () => {
  const text = [
    '[package]',
    'name = "mycrate"',
    '',
    '[dependencies]',
    'serde = "1.0"',
    'tokio = { version = "1", features = ["full"] }',
    'reqwest = "0.11"',
    '',
    '[dev-dependencies]',
    'criterion = "0.5"',
    '',
    '[dependencies.serde_json]',
    'version = "1.0"',
    'features = ["preserve_order"]',
  ].join('\n');
  assert.deepEqual(parseCargoToml(text).sort(), [
    'criterion',
    'reqwest',
    'serde',
    'serde_json',
    'tokio',
  ]);
});

test('collectDependencies reads Cargo.toml (rust ecosystem)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-'));
  try {
    await writeFile(
      path.join(dir, 'Cargo.toml'),
      ['[package]', 'name = "app"', '', '[dependencies]', 'serde = "1.0"', 'tokio = "1"'].join('\n'),
    );
    const { packages } = await collectDependencies(dir);
    assert.deepEqual(packages.map((p) => p.name).sort(), ['serde', 'tokio']);
    assert.ok(packages.every((p) => p.ecosystem === 'rust'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
