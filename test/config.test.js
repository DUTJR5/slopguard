import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, isAllowlisted, isEcosystemIgnored, isOffline, getRegistry } from '../src/config.js';

async function withConfig(obj) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cfg-'));
  if (obj !== null) {
    await writeFile(path.join(dir, 'slopguard.config.json'), JSON.stringify(obj));
  }
  return dir;
}

test('loadConfig returns empty config when no file exists', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cfg-'));
  try {
    const cfg = await loadConfig(dir);
    assert.equal(cfg.file, null);
    assert.equal(cfg.allowset.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadConfig returns empty config when the file is invalid JSON', async () => {
  const dir = await withConfig(null);
  try {
    await writeFile(path.join(dir, 'slopguard.config.json'), '{ not json');
    const cfg = await loadConfig(dir);
    assert.equal(cfg.file, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('allowlist matching is case-insensitive', async () => {
  const dir = await withConfig({ allowlist: ['@MyScope/Inner', 'react'] });
  try {
    const cfg = await loadConfig(dir);
    assert.ok(isAllowlisted(cfg, 'react'));
    assert.ok(isAllowlisted(cfg, 'REACT'));
    assert.ok(isAllowlisted(cfg, '@myscope/inner'));
    assert.ok(!isAllowlisted(cfg, 'vue'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ignoreEcosystems matches listed ecosystems', async () => {
  const dir = await withConfig({ ignoreEcosystems: ['pypi'] });
  try {
    const cfg = await loadConfig(dir);
    assert.ok(isEcosystemIgnored(cfg, 'pypi'));
    assert.ok(!isEcosystemIgnored(cfg, 'npm'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('offline flag is read from config', async () => {
  const off = await withConfig({ offline: true });
  const on = await withConfig({});
  try {
    assert.ok(isOffline(await loadConfig(off)));
    assert.ok(!isOffline(await loadConfig(on)));
  } finally {
    await rm(off, { recursive: true, force: true });
    await rm(on, { recursive: true, force: true });
  }
});

test('getRegistry overrides default and trims trailing slash', async () => {
  const dir = await withConfig({
    registries: {
      npm: 'https://npm.mycompany.com/',
      pypi: 'https://pypi.mycompany.com/simple',
      rubygems: 'https://gems.mycompany.com',
    },
  });
  try {
    const cfg = await loadConfig(dir);
    assert.equal(getRegistry(cfg, 'npm'), 'https://npm.mycompany.com');
    assert.equal(getRegistry(cfg, 'pypi'), 'https://pypi.mycompany.com/simple');
    assert.equal(getRegistry(cfg, 'rubygems'), 'https://gems.mycompany.com');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getRegistry falls back to public default when not overridden', async () => {
  const dir = await withConfig({ allowlist: ['x'] });
  try {
    const cfg = await loadConfig(dir);
    assert.equal(getRegistry(cfg, 'npm'), 'https://registry.npmjs.org');
    assert.equal(getRegistry(cfg, 'pypi'), 'https://pypi.org');
    assert.equal(getRegistry(cfg, 'rubygems'), 'https://rubygems.org');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
