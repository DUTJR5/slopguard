// Parse lockfiles from several ecosystems and return the set of locked packages.
//
// We support lockfiles for npm (package-lock.json, yarn.lock, pnpm-lock.yaml)
// and Python (poetry.lock), plus Ruby (Gemfile.lock). No third-party parsers:
// package-lock.json is real JSON, the rest are parsed with small text/line
// scanners that target just the package-name lines.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { walk } from './manifests.js';

// --- per-format pure parsers (exported for unit tests) ---

// package-lock.json (lockfileVersion 2/3): the `packages` object maps
// "node_modules/<name>" keys to their resolved entry. Nested copies live under
// "node_modules/a/node_modules/b", so the real package name is the segment
// after the LAST "node_modules/". The root package uses the "" key.
export function parsePackageLock(jsonText) {
  const names = [];
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return names;
  }
  const pkgs = parsed && parsed.packages;
  if (!pkgs || typeof pkgs !== 'object') return names;
  const prefix = 'node_modules/';
  for (const key of Object.keys(pkgs)) {
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    if (!rel) continue; // root package ("")
    const name = rel.includes(prefix) ? rel.slice(rel.lastIndexOf(prefix) + prefix.length) : rel;
    names.push({ name, ecosystem: 'npm' });
  }
  return names;
}

// yarn.lock (classic): each top-level entry header is one or more
// "name@range" descriptors separated by commas and ending with ":". The header
// line is NOT indented; its properties (version, resolved, ...) are.
function yarnDescriptorName(descriptor) {
  const d = descriptor.trim().replace(/^["']|["']$/g, '');
  if (!d.includes('@')) return null;
  // Scoped package: "@scope/name@range". Take the part up to the range "@".
  let m = /^(@[^/]+\/[^@]+)@/.exec(d);
  if (m) return m[1];
  // Unscoped: "name@range".
  m = /^([^@]+)@/.exec(d);
  if (m) return m[1];
  return null;
}

export function parseYarnLock(text) {
  const names = [];
  const seen = new Set();
  for (const raw of text.split('\n')) {
    if (/^\s/.test(raw)) continue; // skip indented property lines
    const line = raw.trim();
    if (!line.endsWith(':')) continue;
    const header = line.slice(0, -1);
    for (const desc of header.split(',')) {
      const name = yarnDescriptorName(desc);
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push({ name, ecosystem: 'npm' });
      }
    }
  }
  return names;
}

// pnpm-lock.yaml: under the top-level `packages:` key, each entry is a package
// key indented exactly two spaces, shaped "/name@version" (or "name@version").
// Nested properties (resolution:, dependencies:, ...) sit at >=4 spaces and are
// ignored.
export function parsePnpmLock(text) {
  const names = [];
  const lines = text.split('\n');
  let inPackages = false;
  for (const line of lines) {
    if (!inPackages) {
      if (/^packages:\s*$/.test(line)) inPackages = true;
      continue;
    }
    // Leave the packages section on the next top-level (non-indented, non-blank)
    // key; blank lines between entries are preserved by staying in the section.
    if (line !== '' && !/^\s/.test(line)) {
      inPackages = false;
      continue;
    }
    if (line === '') continue;
    if (!/^  [^ ]/.test(line)) continue; // only 2-space-indented keys; skip properties
    // A pnpm key is "/name@version" (or "/@scope/name@version"). The version
    // separator is the LAST "@", so capture everything before it.
    const m = /^\s+['"]?\/?(.*)@.*$/.exec(line);
    if (m && m[1]) names.push({ name: m[1], ecosystem: 'npm' });
  }
  return names;
}

// poetry.lock: a sequence of [[package]] tables; each has a `name = "..."`.
export function parsePoetryLock(text) {
  const names = [];
  let inPackage = false;
  for (const line of text.split('\n')) {
    if (/^\[\[package\]\]/.test(line)) {
      inPackage = true;
      continue;
    }
    // Any other top-level table (e.g. [metadata]) ends the current package block.
    if (inPackage && /^\[[^[]/.test(line)) {
      inPackage = false;
      continue;
    }
    if (inPackage) {
      const m = /^name\s*=\s*["']([^"']+)["']/.exec(line);
      if (m) {
        names.push({ name: m[1], ecosystem: 'pypi' });
        inPackage = false; // only the first name= line matters per package
      }
    }
  }
  return names;
}

// Gemfile.lock: inside the GEM block there is a `specs:` sub-block. The gems
// declared there sit two spaces deeper than `specs:`; their dependencies sit
// another two spaces deeper and are ignored.
export function parseGemfileLock(text) {
  const names = [];
  let inGemBlock = false;
  let inSpecs = false;
  let baseIndent = null;
  for (const line of text.split('\n')) {
    if (/^GEM\s*$/.test(line)) {
      inGemBlock = true;
      inSpecs = false;
      baseIndent = null;
      continue;
    }
    if (inGemBlock && /^\s*specs:\s*$/.test(line)) {
      inSpecs = true;
      baseIndent = line.search(/\S/);
      continue;
    }
    if (inSpecs) {
      if (!/^\s/.test(line)) {
        inGemBlock = false;
        inSpecs = false;
        continue;
      }
      const indent = line.search(/\S/);
      if (indent === baseIndent + 2) {
        const m = /^\s+(\S+)\s*\(/.exec(line);
        if (m) names.push({ name: m[1], ecosystem: 'rubygems' });
      }
    }
  }
  return names;
}

// go.sum: each non-comment line is "<module> <version> <hash>" (or
// "<module> <version>/go.mod <hash>"). The module path is the first token. A
// module appears twice (once for the package, once for its go.mod), so we
// deduplicate by name.
export function parseGoSum(text) {
  const seen = new Set();
  const names = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tok = line.split(/\s+/)[0];
    if (tok && !seen.has(tok)) {
      seen.add(tok);
      names.push({ name: tok, ecosystem: 'go' });
    }
  }
  return names;
}

// Cargo.lock: a sequence of [[package]] tables, each with a `name = "..."`.
export function parseCargoLock(text) {
  const names = [];
  let inPackage = false;
  for (const line of text.split('\n')) {
    if (/^\[\[package\]\]/.test(line)) {
      inPackage = true;
      continue;
    }
    // Any other top-level table (e.g. [metadata], [patch.*]) ends the block.
    if (inPackage && /^\[[^[]/.test(line)) {
      inPackage = false;
      continue;
    }
    if (inPackage) {
      const m = /^name\s*=\s*["']([^"']+)["']/.exec(line);
      if (m) {
        names.push({ name: m[1], ecosystem: 'rust' });
        inPackage = false;
      }
    }
  }
  return names;
}

/**
 * Find lockfiles under `root` and return every locked package.
 *
 * @param {string} root
 * @returns {Promise<{packages: Array<{name: string, ecosystem: string}>, lockfiles: string[]}>}
 */
export async function collectLockedPackages(root) {
  const files = await walk(root);
  const packages = [];
  const lockfiles = [];
  const seen = new Set();

  const add = (name, ecosystem) => {
    const key = `${ecosystem}:${name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      packages.push({ name, ecosystem });
    }
  };

  for (const file of files) {
    const base = path.basename(file);
    let parsed = null;
    if (base === 'package-lock.json') {
      lockfiles.push(file);
      parsed = parsePackageLock(await readFile(file, 'utf8'));
    } else if (base === 'yarn.lock') {
      lockfiles.push(file);
      parsed = parseYarnLock(await readFile(file, 'utf8'));
    } else if (base === 'pnpm-lock.yaml') {
      lockfiles.push(file);
      parsed = parsePnpmLock(await readFile(file, 'utf8'));
    } else if (base === 'poetry.lock') {
      lockfiles.push(file);
      parsed = parsePoetryLock(await readFile(file, 'utf8'));
    } else if (base === 'Gemfile.lock') {
      lockfiles.push(file);
      parsed = parseGemfileLock(await readFile(file, 'utf8'));
    } else if (base === 'go.sum') {
      lockfiles.push(file);
      parsed = parseGoSum(await readFile(file, 'utf8'));
    } else if (base === 'Cargo.lock') {
      lockfiles.push(file);
      parsed = parseCargoLock(await readFile(file, 'utf8'));
    }
    if (parsed) for (const p of parsed) add(p.name, p.ecosystem);
  }

  return { packages, lockfiles };
}
