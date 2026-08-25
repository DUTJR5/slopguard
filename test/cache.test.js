import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCache } from '../src/cache.js';

const DAY = 86400000;

test('set then get returns the stored entry within TTL', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cache-'));
  try {
    const cache = createCache(dir, { enabled: true });
    await cache.set('npm:react', { exists: true, checkedAt: Date.now(), metadata: { createdAt: 1 } });
    const hit = await cache.get('npm:react');
    assert.ok(hit);
    assert.equal(hit.exists, true);
    assert.deepEqual(hit.metadata, { createdAt: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('get returns null for unknown key', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cache-'));
  try {
    const cache = createCache(dir, { enabled: true });
    assert.equal(await cache.get('npm:missing'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('entries older than 24h are treated as a miss', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cache-'));
  try {
    const cache = createCache(dir, { enabled: true });
    await cache.set('npm:react', { exists: true, checkedAt: Date.now() - 25 * DAY, metadata: null });
    assert.equal(await cache.get('npm:react'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('save persists entries and a second cache instance can read them (warm hit)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cache-'));
  try {
    const a = createCache(dir, { enabled: true });
    await a.set('npm:react', { exists: true, checkedAt: Date.now(), metadata: { createdAt: 1 } });
    await a.save();

    const b = createCache(dir, { enabled: true });
    const hit = await b.get('npm:react');
    assert.ok(hit, 'warm cache should read the persisted entry');
    assert.equal(b.stats.hits, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('disabled cache never stores or serves anything', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cache-'));
  try {
    const cache = createCache(dir, { enabled: false });
    await cache.set('npm:react', { exists: true, checkedAt: Date.now(), metadata: {} });
    assert.equal(await cache.get('npm:react'), null);
    await cache.save();
    // No cache file should have been written.
    await assert.rejects(() => readFile(path.join(dir, '.slopguard-cache.json')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('get increments the hit counter, set marks dirty', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-cache-'));
  try {
    const cache = createCache(dir, { enabled: true });
    await cache.set('npm:a', { exists: true, checkedAt: Date.now(), metadata: null });
    await cache.set('npm:b', { exists: false, checkedAt: Date.now(), metadata: null });
    await cache.get('npm:a');
    await cache.get('npm:a');
    assert.equal(cache.stats.hits, 2);
    assert.equal(cache.stats.fetches, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
