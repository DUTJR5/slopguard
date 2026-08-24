// Baseline support.
//
// A baseline is a snapshot of the findings you already know about. After you
// write one with `--write-baseline`, future runs pass `--baseline` and any
// finding that is already in the baseline is suppressed from the report AND
// does not affect the exit code. New findings still show up and still fail CI.
//
// This keeps the tool useful in a project that already has a few "known weird"
// packages: you acknowledge them once instead of fighting the tool forever.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASELINE_NAME = 'slopguard-baseline.json';

// The shape of a baseline file:
//   {
//     "notFound":   ["not-found:npm:somepkg", ...],
//     "typosquats": ["typosquat:pypi:flaskk", ...],
//     "undeclared": ["undeclared:npm:left-pad", ...]
//   }
//
// Each entry is a stable key built from the finding's type, ecosystem and name.

export function notFoundKey(r) {
  return `not-found:${r.ecosystem}:${r.name.toLowerCase()}`;
}
export function typosquatKey(w) {
  return `typosquat:${w.ecosystem}:${w.name.toLowerCase()}`;
}
export function undeclaredKey(imp) {
  return `undeclared:${imp.ecosystem}:${imp.name.toLowerCase()}`;
}

/**
 * Build the three key lists from the current scan findings.
 */
export function buildBaseline(missing, warnings, undeclared) {
  return {
    notFound: missing.map(notFoundKey),
    typosquats: warnings.map(typosquatKey),
    undeclared: undeclared.map(undeclaredKey),
  };
}

/**
 * Write the baseline file into `root`.
 */
export async function writeBaseline(root, missing, warnings, undeclared) {
  const file = path.join(root, BASELINE_NAME);
  await writeFile(file, JSON.stringify(buildBaseline(missing, warnings, undeclared), null, 2) + '\n', 'utf8');
  return file;
}

/**
 * Load the baseline from `root`, returning null when there is no file.
 */
export async function loadBaseline(root) {
  try {
    const data = JSON.parse(await readFile(path.join(root, BASELINE_NAME), 'utf8'));
    return {
      notFound: new Set((data.notFound || []).map(String)),
      typosquats: new Set((data.typosquats || []).map(String)),
      undeclared: new Set((data.undeclared || []).map(String)),
    };
  } catch {
    return null;
  }
}

/**
 * Filter out findings that are already in the baseline.
 *
 * @returns {{missing: Array, warnings: Array, undeclared: Array}}
 */
export function applyBaseline(findings, baseline) {
  if (!baseline) return findings;
  return {
    missing: findings.missing.filter((r) => !baseline.notFound.has(notFoundKey(r))),
    warnings: findings.warnings.filter((w) => !baseline.typosquats.has(typosquatKey(w))),
    undeclared: findings.undeclared.filter((imp) => !baseline.undeclared.has(undeclaredKey(imp))),
  };
}
