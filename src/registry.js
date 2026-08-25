// Check whether packages exist in their registry, with bounded concurrency
// and per-request timeouts. No third-party dependencies.
//
// Each ecosystem has its own API shape, so we keep a small adapter per
// ecosystem. The adapter builds the request URL and turns a 200 response into
// `{ exists, metadata }`. `metadata` is the small, normalized object the risk
// scorer needs: `{ createdAt, downloadsLastWeek }` (both nullable — not every
// registry exposes both). The base URL comes from the user config (private
// registry support); the public defaults apply when no override is set.
//
// Results are cached on disk by src/cache.js: a warm run reuses yesterday's
// verdicts and metadata instead of hitting the network again.

import { DEFAULT_REGISTRIES, getRegistry } from './config.js';

const CONCURRENCY = 8;
const TIMEOUT_MS = 8000;
const USER_AGENT = 'slopguard (https://github.com/DUTJR5/slopguard)';

// Go module proxy path escaping (Go's module/zip.EscapePath): each uppercase
// letter is prefixed with '!' and lowercased. e.g.
//   "github.com/Shopify/go-que" -> "github.com/!shopify/go-que"
// Lowercase letters and punctuation pass through unchanged.
export function goModuleEscape(modulePath) {
  let out = '';
  for (const ch of modulePath) {
    if (ch >= 'A' && ch <= 'Z') out += '!' + ch.toLowerCase();
    else out += ch;
  }
  return out;
}

// --- per-ecosystem adapter: build the request URL and turn the HTTP response
// into `{ exists, metadata }`. `metadata` is `{ createdAt, downloadsLastWeek }`. ---

const ADAPTERS = {
  npm: {
    url: (name, base) => `${base}/${name.replace('/', '%2f')}`,
    async parse(res) {
      const body = await res.json().catch(() => null);
      let createdAt = null;
      if (body && body.time && body.time.created) {
        const t = Date.parse(body.time.created);
        if (!Number.isNaN(t)) createdAt = t;
      }
      return { exists: true, metadata: { createdAt, downloadsLastWeek: null } };
    },
    // npm publishes weekly download counts at api.npmjs.org. We fetch them as a
    // second request and fold the number into metadata. Failures just leave
    // downloadsLastWeek null (the low-download signal is then skipped).
    async extra(name) {
      const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`;
      try {
        const r = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'user-agent': USER_AGENT },
        });
        if (r.status !== 200) return { downloadsLastWeek: null };
        const j = await r.json().catch(() => null);
        return { downloadsLastWeek: j && typeof j.downloads === 'number' ? j.downloads : null };
      } catch {
        return { downloadsLastWeek: null };
      }
    },
  },
  pypi: {
    url: (name, base) => {
      if (/\/simple$/.test(base)) return `${base}/${encodeURIComponent(name)}/`;
      return `${base}/pypi/${encodeURIComponent(name)}/json`;
    },
    async parse(res) {
      const body = await res.json().catch(() => null);
      let createdAt = null;
      if (body && body.releases && typeof body.releases === 'object') {
        let earliest = Infinity;
        for (const files of Object.values(body.releases)) {
          if (!Array.isArray(files)) continue;
          for (const f of files) {
            if (f && f.upload_time) {
              const t = Date.parse(f.upload_time);
              if (!Number.isNaN(t) && t < earliest) earliest = t;
            }
          }
        }
        if (earliest !== Infinity) createdAt = earliest;
      }
      // PyPI has no public download-count API, so downloadsLastWeek stays null
      // and the low-download signal is skipped for PyPI (see src/risk.js).
      return { exists: true, metadata: { createdAt, downloadsLastWeek: null } };
    },
  },
  rubygems: {
    url: (name, base) => `${base}/api/v1/gems/${encodeURIComponent(name)}.json`,
    async parse(res) {
      const body = await res.json().catch(() => null);
      let createdAt = null;
      if (body && body.created_at) {
        const t = Date.parse(body.created_at);
        if (!Number.isNaN(t)) createdAt = t;
      }
      // RubyGems exposes only total all-time downloads, not a weekly figure,
      // so downloadsLastWeek stays null (the low-download signal is npm-only).
      return { exists: true, metadata: { createdAt, downloadsLastWeek: null } };
    },
  },
  go: {
    url: (name, base) => `${base}/${goModuleEscape(name)}/@v/list`,
    async parse() {
      // The /@v/list endpoint returns a newline list of versions; a 200 means
      // the module exists. It carries no publish date, so createdAt stays null.
      return { exists: true, metadata: { createdAt: null, downloadsLastWeek: null } };
    },
  },
  rust: {
    url: (name, base) => `${base}/api/v1/crates/${encodeURIComponent(name)}`,
    async parse(res) {
      const body = await res.json().catch(() => null);
      let createdAt = null;
      if (body && body.crate && body.crate.created_at) {
        const t = Date.parse(body.crate.created_at);
        if (!Number.isNaN(t)) createdAt = t;
      }
      // crates.io has no weekly-download endpoint (only 90-day recent_downloads),
      // so we don't set downloadsLastWeek to avoid mislabeling it as weekly.
      return { exists: true, metadata: { createdAt, downloadsLastWeek: null } };
    },
  },
};

/**
 * Build the existence-check URL for a package in a registry. Delegates to the
 * per-ecosystem adapter.
 *
 * @param {string} name
 * @param {'npm'|'pypi'|'rubygems'|'go'|'rust'} ecosystem
 * @param {string} baseUrl  registry base URL (no trailing slash)
 * @returns {string}
 */
export function registryUrl(name, ecosystem, baseUrl) {
  const adapter = ADAPTERS[ecosystem];
  if (!adapter) throw new Error(`unsupported ecosystem: ${ecosystem}`);
  return adapter.url(name, baseUrl);
}

// Perform the network existence check and return `{ exists, metadata }` or a
// `{ exists: null, reason }` object when the verdict is uncertain.
async function fetchExists(name, ecosystem, cfg) {
  const adapter = ADAPTERS[ecosystem];
  if (!adapter) return { exists: null, reason: `unsupported ecosystem: ${ecosystem}` };
  const base = getRegistry(cfg, ecosystem) || DEFAULT_REGISTRIES[ecosystem];
  let res;
  try {
    res = await fetch(adapter.url(name, base), {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT },
    });
  } catch {
    return { exists: null, reason: 'network error or timeout' };
  }

  if (res.status === 404) {
    await res.arrayBuffer().catch(() => {}); // drain so the connection can be reused
    return { exists: false, metadata: null };
  }
  if (res.status !== 200) {
    await res.arrayBuffer().catch(() => {});
    return { exists: null, reason: `registry returned ${res.status}` };
  }

  const parsed = await adapter.parse(res);
  if (adapter.extra) {
    const extra = await adapter.extra(name);
    parsed.metadata = { ...parsed.metadata, ...extra };
  }
  return parsed; // { exists: true, metadata }
}

/**
 * Check one package. When `offline` is true we skip the network entirely and
 * return `exists: null` (treated as "uncertain"), so offline runs never invent
 * a false "not found" verdict. Typosquat detection still runs because it is
 * purely local.
 *
 * With a cache, a fresh entry is served without a network request; a miss
 * (or disabled cache) performs the fetch and, for a definitive verdict, stores
 * the result back into the cache.
 *
 * @param {string} name
 * @param {string} ecosystem
 * @param {object} cfg  config object from src/config.js
 * @param {{offline?: boolean, cache?: object|null}} [opts]
 */
export async function checkPackage(name, ecosystem, cfg, { offline = false, cache = null } = {}) {
  if (offline) {
    return { name, ecosystem, exists: null, reason: 'offline mode: network checks skipped' };
  }
  const key = `${ecosystem}:${name}`;
  if (cache) {
    const hit = await cache.get(key);
    if (hit) return { name, ecosystem, exists: hit.exists, metadata: hit.metadata || null, cached: true };
  }
  if (cache) cache.stats.fetches++;

  const result = await fetchExists(name, ecosystem, cfg);

  // Only cache definitive (true/false) verdicts, never uncertain ones.
  if (cache && (result.exists === true || result.exists === false)) {
    await cache.set(key, {
      exists: result.exists,
      checkedAt: Date.now(),
      metadata: result.metadata || null,
    });
  }
  return { name, ecosystem, ...result };
}

/**
 * Check many packages with a small worker pool.
 * @param {Array<{name: string, ecosystem: string}>} packages
 * @param {object} cfg  config object from src/config.js
 * @param {{offline?: boolean, cache?: object|null}} [opts]
 */
export async function checkPackages(packages, cfg, { offline = false, cache = null } = {}) {
  const results = new Array(packages.length);
  let next = 0;

  async function worker() {
    while (next < packages.length) {
      const i = next++;
      results[i] = await checkPackage(packages[i].name, packages[i].ecosystem, cfg, { offline, cache });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, packages.length) }, worker));
  return results;
}
