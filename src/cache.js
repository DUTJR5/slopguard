// On-disk response cache for registry lookups.
//
// We write a single `.slopguard-cache.json` into the scanned directory. Each
// entry is keyed by `ecosystem:packageName` and holds the existence verdict
// plus the registry metadata we pulled for risk scoring, with a timestamp:
//
//   {
//     "npm:react": { "exists": true, "checkedAt": 1690000000000, "metadata": {...} },
//     ...
//   }
//
// Entries older than 24 hours are treated as a miss, so we still pick up
// packages published or removed in the last day. We never cache "uncertain"
// (null) results, because those are usually transient network blips and we
// don't want to freeze a wrong answer for a whole day.
//
// `--no-cache` disables the cache entirely (enabled: false) — every check hits
// the network.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_NAME = '.slopguard-cache.json';
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Create a cache bound to `root`.
 *
 * @param {string} root  scanned directory; the cache file lives here
 * @param {{enabled?: boolean}} [opts]
 */
export function createCache(root, { enabled = true } = {}) {
  const file = path.join(root, CACHE_NAME);
  let data = null; // parsed JSON, loaded lazily
  let loadPromise = null; // shared so concurrent readers wait for one load
  let dirty = false;
  const stats = { hits: 0, fetches: 0 };

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (!enabled) {
        data = {};
        return;
      }
      try {
        data = JSON.parse(await readFile(file, 'utf8'));
        if (!data || typeof data !== 'object') data = {};
      } catch {
        data = {};
      }
    })();
    return loadPromise;
  }

  /**
   * Return a fresh cache entry, or null on miss (missing file, expired, or
   * disabled). On a hit, increments the hit counter.
   * @param {string} key  `ecosystem:name`
   * @returns {Promise<{exists: boolean, checkedAt: number, metadata: object|null}|null>}
   */
  async function get(key) {
    if (!enabled) return null;
    await load();
    const entry = data[key];
    if (!entry || typeof entry.checkedAt !== 'number') return null;
    if (Date.now() - entry.checkedAt > TTL_MS) return null;
    stats.hits++;
    return entry;
  }

  /**
   * Store a definitive result (exists is true or false). Does not write to disk
   * immediately; call save() once at the end of the scan.
   */
  async function set(key, value) {
    if (!enabled) return;
    await load();
    data[key] = value; // { exists, checkedAt, metadata }
    dirty = true;
  }

  /** Persist the cache file if anything changed. */
  async function save() {
    if (!enabled || !dirty) return;
    await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    dirty = false;
  }

  return { enabled, stats, file, get, set, save };
}
