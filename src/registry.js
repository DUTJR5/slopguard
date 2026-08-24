// Check whether packages exist in their registry, with bounded concurrency
// and per-request timeouts. No third-party dependencies.
//
// The base URL for each ecosystem comes from the user config (private registry
// support); see src/config.js. The public defaults are used when no override is
// set.

import { DEFAULT_REGISTRIES, getRegistry } from './config.js';

const CONCURRENCY = 8;
const TIMEOUT_MS = 8000;

async function fetchStatus(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'slopguard (https://github.com/DUTJR5/slopguard)' },
    });
    // Drain the body so the connection can be reused.
    await res.arrayBuffer().catch(() => {});
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null; // rate limited, server error, etc.
  } catch {
    return null; // network failure or timeout
  }
}

/**
 * Build the existence-check URL for a package in a registry.
 *
 * Each ecosystem has its own API shape, and private registries sometimes
 * differ from the public ones:
 *
 *   npm       -> {base}/{name}
 *                Scoped packages use a `%2f` separator, e.g.
 *                "@scope/name" -> "{base}/@scope%2fname".
 *                This works on both registry.npmjs.org and most private npm
 *                mirrors (Verdaccio, Artifactory, ...).
 *
 *   pypi      -> {base}/pypi/{name}/json
 *                The public PyPI (and many mirrors) expose a JSON API at
 *                /pypi/{name}/json, so we prefer that.
 *                BUT a private PyPI index that only serves the "simple" index
 *                (the PEP 503 page, e.g. .../simple) has NO JSON API. For those
 *                we degenerate to a plain GET of "{base}/{name}/" and treat
 *                HTTP 200 as "exists" and 404 as "missing". We detect the simple
 *                index by the "/simple" suffix on the configured base URL; that
 *                is the common way people point slopguard at a devpi/Artifactory
 *                PyPI mirror. If you hit a private PyPI that exposes the JSON
 *                API under a different path, override accordingly.
 *
 *   rubygems  -> {base}/api/v1/gems/{name}.json
 *
 * @param {string} name
 * @param {'npm'|'pypi'|'rubygems'} ecosystem
 * @param {string} baseUrl  registry base URL (no trailing slash)
 * @returns {string}
 */
export function registryUrl(name, ecosystem, baseUrl) {
  if (ecosystem === 'npm') {
    // Scoped packages: @scope/name -> @scope%2fname
    return `${baseUrl}/${name.replace('/', '%2f')}`;
  }
  if (ecosystem === 'pypi') {
    // Simple index (PEP 503) has no JSON API: degrade to a 200/404 HEAD-style GET.
    if (/\/simple$/.test(baseUrl)) {
      return `${baseUrl}/${encodeURIComponent(name)}/`;
    }
    return `${baseUrl}/pypi/${encodeURIComponent(name)}/json`;
  }
  if (ecosystem === 'rubygems') {
    return `${baseUrl}/api/v1/gems/${encodeURIComponent(name)}.json`;
  }
  throw new Error(`unsupported ecosystem: ${ecosystem}`);
}

/**
 * Check one package. When `offline` is true we skip the network entirely and
 * return `exists: null` (treated as "uncertain"), so offline runs never invent
 * a false "not found" verdict. Typosquat detection still runs because it is
 * purely local.
 *
 * @param {object} cfg  config object from src/config.js
 * @param {string} name
 * @param {string} ecosystem
 * @param {boolean} [offline]
 */
export async function checkPackage(name, ecosystem, cfg, offline = false) {
  if (offline) {
    return { name, ecosystem, exists: null, reason: 'offline mode: network checks skipped' };
  }
  const base = getRegistry(cfg, ecosystem) || DEFAULT_REGISTRIES[ecosystem];
  const exists = await fetchStatus(registryUrl(name, ecosystem, base));
  return {
    name,
    ecosystem,
    exists,
    ...(exists === null ? { reason: 'registry unreachable or returned an unexpected status' } : {}),
  };
}

/**
 * Check many packages with a small worker pool.
 * @param {Array<{name: string, ecosystem: string}>} packages
 * @param {object} cfg  config object from src/config.js
 * @param {boolean} [offline]
 */
export async function checkPackages(packages, cfg, offline = false) {
  const results = new Array(packages.length);
  let next = 0;

  async function worker() {
    while (next < packages.length) {
      const i = next++;
      results[i] = await checkPackage(packages[i].name, packages[i].ecosystem, cfg, offline);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, packages.length) }, worker));
  return results;
}
