// Detect package names that look like a slightly-tweaked version of a well-known
// package (typosquatting). We compare every checked name against a short list of
// the most popular packages using the Levenshtein edit distance and flag names
// that are one or two edits away. No third-party dependencies.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Levenshtein edit distance (no dependencies) ---
//
// The number of single-character insertions, deletions or substitutions needed
// to turn `a` into `b`. A tiny two-row rolling buffer keeps memory at O(len(b)).
export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
}

// Load the top-packages list for an ecosystem (cached after the first read).
const cache = new Map();
async function loadTop(ecosystem) {
  if (cache.has(ecosystem)) return cache.get(ecosystem);
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'top-packages.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  const list = data[ecosystem] || [];
  cache.set(ecosystem, list);
  return list;
}

/**
 * Compare `name` against the top packages of its ecosystem and return the ones
 * that look like a typo of a well-known package.
 *
 * Distance rule: a short name (< 5 chars) is only flagged at distance 1, because
 * at distance 2 short names collide with many unrelated packages and produce
 * noise. Longer names are flagged at distance 1 and 2.
 *
 * @param {string} name
 * @param {'npm'|'pypi'} ecosystem
 * @returns {Promise<Array<{name: string, distance: number}>>}
 */
export async function findTyposquats(name, ecosystem) {
  const top = await loadTop(ecosystem);
  const lower = name.toLowerCase();
  // A name that already is a well-known package is not a typosquat of another
  // one (e.g. "flask" is distance-2 from "black", but it is its own famous
  // package). Skip those so we only flag suspicious look-alikes.
  if (top.some((c) => c.toLowerCase() === lower)) return [];
  const maxDist = lower.length < 5 ? 1 : 2;
  const matches = [];
  for (const candidate of top) {
    if (candidate.toLowerCase() === lower) continue; // it IS the real package
    const d = levenshtein(lower, candidate.toLowerCase());
    if (d >= 1 && d <= maxDist) {
      matches.push({ name: candidate, distance: d });
    }
  }
  // Closest look-alikes first; stable order within the same distance.
  matches.sort((x, y) => x.distance - y.distance);
  return matches;
}
