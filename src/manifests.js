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
 * Find manifests under `root` and return every declared dependency.
 * @returns {Promise<{packages: Array<{name: string, ecosystem: 'npm'|'pypi'}>, manifests: string[]}>}
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
    }
  }

  return { packages, manifests };
}
