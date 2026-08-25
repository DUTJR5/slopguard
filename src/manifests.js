// Extract dependency names from common manifest files.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', '.venv', 'venv']);

export async function walk(dir, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...(await walk(full, depth + 1, maxDepth)));
    } else {
      files.push(full);
    }
  }
  return files;
}

function depsFromPackageJson(jsonText) {
  const names = [];
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return names;
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (parsed[field] && typeof parsed[field] === 'object') {
      names.push(...Object.keys(parsed[field]));
    }
  }
  return names;
}

// Gemfile: each `gem 'name'` / `gem "name"` line declares a dependency. Lines
// inside groups / source blocks still contain the bare `gem 'name'` token, and
// comment lines start with `#` so they are skipped by the leading `^\s*gem`.
export function depsFromGemfile(text) {
  const names = [];
  const re = /^\s*gem\s+['"]([^'"]+)['"]/;
  for (const line of text.split('\n')) {
    const m = re.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

function depsFromRequirements(text) {
  const names = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue; // comments, -r/-e flags
    // Strip environment markers, extras and version specifiers.
    const name = line
      .split(';')[0]
      .replace(/\[.*?\]/, '')
      .split(/[=<>!~@\s]/)[0]
      .trim();
    if (name && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) names.push(name);
  }
  return names;
}

/**
 * Parse the `require` section of a go.mod file.
 *
 * Go lists modules (not packages) under `require`. They appear either as a
 * single `require github.com/foo/bar v1.2.3` line or inside a fenced block:
 *
 *   require (
 *       github.com/gin-gonic/gin v1.9.1
 *       github.com/stretchr/testify v1.8.4 // indirect
 *   )
 *
 * The module path is the first whitespace-separated token on each require line.
 * We return those paths; the registry check later confirms they exist.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseGoMod(text) {
  const names = [];
  let inRequire = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;
    if (!inRequire) {
      if (/^require\s*\($/.test(line)) {
        inRequire = true;
        continue;
      }
      const single = /^require\s+(\S+)/.exec(line);
      if (single) {
        names.push(single[1]);
        continue;
      }
      continue;
    }
    if (line === ')') {
      inRequire = false;
      continue;
    }
    const tok = line.split(/\s+/)[0];
    if (tok) names.push(tok);
  }
  return names;
}

/**
 * Parse dependency names from a Cargo.toml file (line-based, no TOML library).
 *
 * We only read the `[dependencies]` and `[dev-dependencies]` sections. A crate
 * is declared either by a `name = "1.0"` key line, or by a sub-table header
 * `[dependencies.foo]` / `[dev-dependencies.foo]`. The inner keys of a sub-table
 * belong to that crate and are NOT separate dependencies, so we skip them.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseCargoToml(text) {
  const names = [];
  let section = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1].trim();
      // A sub-table like [dependencies.foo] declares the crate "foo" directly.
      const sub = /^(?:dev-)?dependencies\.([^\s]+)$/.exec(section);
      if (sub) names.push(sub[1]);
      continue;
    }
    if (section === 'dependencies' || section === 'dev-dependencies') {
      const m = /^([A-Za-z0-9_-]+)\s*=\s*/.exec(line);
      if (m) names.push(m[1]);
    }
  }
  return names;
}

/**
 * Find manifests under `root` and return every declared dependency.
 * @returns {Promise<{packages: Array<{name: string, ecosystem: 'npm'|'pypi'|'rubygems'|'go'|'rust'}>, manifests: string[]}>}
 */
export async function collectDependencies(root) {
  const files = await walk(root);
  const packages = [];
  const seen = new Set();
  const manifests = [];

  const add = (name, ecosystem) => {
    const key = `${ecosystem}:${name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      packages.push({ name, ecosystem });
    }
  };

  for (const file of files) {
    const base = path.basename(file);
    if (base === 'package.json') {
      manifests.push(file);
      for (const name of depsFromPackageJson(await readFile(file, 'utf8'))) add(name, 'npm');
    } else if (base === 'requirements.txt' || /^requirements-.*\.txt$/.test(base)) {
      manifests.push(file);
      for (const name of depsFromRequirements(await readFile(file, 'utf8'))) add(name, 'pypi');
    } else if (base === 'Gemfile') {
      manifests.push(file);
      for (const name of depsFromGemfile(await readFile(file, 'utf8'))) add(name, 'rubygems');
    } else if (base === 'go.mod') {
      manifests.push(file);
      for (const name of parseGoMod(await readFile(file, 'utf8'))) add(name, 'go');
    } else if (base === 'Cargo.toml') {
      manifests.push(file);
      for (const name of parseCargoToml(await readFile(file, 'utf8'))) add(name, 'rust');
    }
  }

  return { packages, manifests };
}
