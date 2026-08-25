// Project configuration for slopguard.
//
// Users can drop a `slopguard.config.json` file in the directory they scan to
// tune the tool to their setup. The whole point is to reduce false positives
// and to point the tool at private registries. This module reads that file and
// answers the small questions the rest of the code asks:
//
//   - isAllowlisted(name):  skip every check for this package
//   - isEcosystemIgnored(eco):  skip a whole ecosystem (e.g. pypi)
//   - isOffline():           don't touch the network at all
//   - getRegistry(eco):      the base URL to use for a given ecosystem
//
// Reading the config never makes a network request.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CONFIG_NAME = 'slopguard.config.json';

// Default public registry base URLs. Private configs override these per
// ecosystem via the `registries` field.
export const DEFAULT_REGISTRIES = {
  npm: 'https://registry.npmjs.org',
  pypi: 'https://pypi.org',
  rubygems: 'https://rubygems.org',
  go: 'https://proxy.golang.org',
  rust: 'https://crates.io',
};

/**
 * Load `slopguard.config.json` from `root`, if present.
 *
 * Missing file or unreadable/invalid JSON is treated as "no config" (an empty
 * object) rather than an error, so a broken config file does not break a scan.
 *
 * @param {string} root
 * @returns {Promise<{raw: object, allowset: Set<string>, file: string|null}>}
 */
export async function loadConfig(root) {
  const file = path.join(root, CONFIG_NAME);
  let raw = {};
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
    if (!raw || typeof raw !== 'object') raw = {};
  } catch {
    raw = {};
  }
  const allowlist = Array.isArray(raw.allowlist) ? raw.allowlist : [];
  const allowset = new Set(allowlist.map((n) => String(n).toLowerCase()));
  return { raw, allowset, file: Object.keys(raw).length ? file : null };
}

/**
 * True if `name` is in the allowlist. Matching is case-insensitive because
 * package names are case-insensitive in npm/PyPI/RubyGems.
 */
export function isAllowlisted(config, name) {
  return config.allowset.has(String(name).toLowerCase());
}

/**
 * True if the config lists `ecosystem` under `ignoreEcosystems`.
 */
export function isEcosystemIgnored(config, ecosystem) {
  const list = config.raw.ignoreEcosystems;
  return Array.isArray(list) && list.map(String).includes(String(ecosystem));
}

/**
 * True if the config sets `offline: true`.
 */
export function isOffline(config) {
  return config.raw.offline === true;
}

/**
 * Base URL for an ecosystem. Falls back to the public default when the config
 * does not override it.
 *
 * @param {object} config
 * @param {'npm'|'pypi'|'rubygems'} ecosystem
 * @returns {string}
 */
export function getRegistry(config, ecosystem) {
  const overrides = config && config.raw && config.raw.registries;
  if (overrides && typeof overrides === 'object' && typeof overrides[ecosystem] === 'string') {
    return overrides[ecosystem].replace(/\/+$/, ''); // trim trailing slash
  }
  return DEFAULT_REGISTRIES[ecosystem];
}
