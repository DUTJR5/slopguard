#!/usr/bin/env node

import path from 'node:path';
import { collectDependencies } from '../src/manifests.js';
import { collectLockedPackages } from '../src/lockfiles.js';
import { collectImports } from '../src/imports.js';
import { checkPackages } from '../src/registry.js';
import { findTyposquats } from '../src/typosquat.js';
import { toSarif } from '../src/sarif.js';
import { loadConfig, isAllowlisted, isEcosystemIgnored, isOffline } from '../src/config.js';
import { writeBaseline, loadBaseline, applyBaseline } from '../src/baseline.js';

const args = process.argv.slice(2);
const command = args[0];

const HELP = `slopguard - catch hallucinated and typosquatted dependencies

Usage:
  slopguard scan [path] [options]

Commands:
  scan [path]   Scan manifests, lockfiles and source imports under [path] (default: current directory)

Options:
  --format <fmt>        Output format: text (default), json, or sarif (SARIF 2.1.0)
  --quiet               Only print suspicious packages
  --no-imports          Skip source-import scanning; only check manifest dependencies
  --config <file>       Path to a slopguard config file (default: <path>/slopguard.config.json)
  --offline             Do not make any network requests; only local checks run (typosquat
                        detection still works). Packages are reported as uncertain, not failed.
  --write-baseline      Write the current findings to slopguard-baseline.json and exit 0
  --baseline            Suppress findings already listed in slopguard-baseline.json
  --help                Show this help

Config file (slopguard.config.json):
  allowlist:        string[]  - package names to skip entirely (private/internal packages)
  ignoreEcosystems: string[]  - skip a whole ecosystem, e.g. ["pypi"]
  offline:          boolean   - same as --offline
  registries:       object    - override registry base URLs, e.g.
                                {"npm": "https://npm.mycompany.com",
                                 "pypi": "https://pypi.mycompany.com/simple",
                                 "rubygems": "https://gems.mycompany.com"}

Exit codes:
  0  all declared packages exist in their registry (or were suppressed by a baseline)
  1  one or more packages were NOT found (possible hallucination / typosquat)
  2  usage error or scan failure

Output:
  For packages that exist but resemble a well-known name (typosquat), a
  WARNING line is printed: "WARNING [ecosystem] name -> similar to famous".
  With --json or --format sarif these appear in the "warnings" array.
`;

function parseFlags(rest) {
  const formatIdx = rest.indexOf('--format');
  let format = 'text';
  if (formatIdx !== -1 && rest[formatIdx + 1]) {
    const v = rest[formatIdx + 1];
    if (['text', 'json', 'sarif'].includes(v)) {
      format = v;
    } else {
      console.error(`slopguard: unknown --format "${v}"; expected text, json or sarif`);
      process.exit(2);
    }
  }
  const configIdx = rest.indexOf('--config');
  const configPath = configIdx !== -1 && rest[configIdx + 1] ? rest[configIdx + 1] : null;

  return {
    path: rest.find((a) => !a.startsWith('--') && a !== 'json' && a !== 'sarif' && a !== 'text') || '.',
    json: rest.includes('--json') || format === 'json',
    format,
    quiet: rest.includes('--quiet'),
    noImports: rest.includes('--no-imports'),
    offline: rest.includes('--offline'),
    configPath,
    writeBaseline: rest.includes('--write-baseline'),
    baseline: rest.includes('--baseline'),
  };
}

async function runScan(flags) {
  const root = path.resolve(flags.path);
  const config = await loadConfig(root);
  const offline = flags.offline || isOffline(config);

  const { packages, manifests } = await collectDependencies(root);
  const { packages: locked, lockfiles } = await collectLockedPackages(root);

  // Merge locked packages into the declared set, de-duplicating by ecosystem+name.
  const merged = new Map();
  for (const p of [...packages, ...locked]) {
    merged.set(`${p.ecosystem}:${p.name.toLowerCase()}`, p);
  }
  let allPackages = [...merged.values()];

  // Apply config-driven suppression BEFORE any network work:
  //  - ignoreEcosystems drops a whole ecosystem
  //  - allowlist drops individual package names (private / internal packages)
  const ignoredEcos = new Set();
  allPackages = allPackages.filter((p) => {
    if (isEcosystemIgnored(config, p.ecosystem)) {
      ignoredEcos.add(p.ecosystem);
      return false;
    }
    if (isAllowlisted(config, p.name)) return false;
    return true;
  });

  let imports = [];
  if (!flags.noImports) {
    const found = await collectImports(root);
    imports = found.imports;
  }

  if (allPackages.length === 0 && imports.length === 0) {
    const msg = `No dependency manifests, lockfiles or source imports found under ${root}`;
    if (flags.json) {
      console.log(
        JSON.stringify({ root, manifests: [], packages: [], suspicious: [], undeclaredImports: [] }, null, 2),
      );
    } else {
      console.log(msg);
    }
    return 0;
  }

  if (!flags.quiet && !flags.json && flags.format !== 'sarif') {
    const bits = [`${manifests.length} manifest(s), ${allPackages.length} declared package(s) from ${lockfiles.length + manifests.length} file(s)`];
    if (!flags.noImports) bits.push(`${imports.length} source import(s)`);
    if (ignoredEcos.size) bits.push(`ignored ecosystem(es): ${[...ignoredEcos].join(', ')}`);
    if (offline) bits.push('offline mode');
    console.log(`Scanning ${bits.join(', ')} under ${root}...`);
  }

  const results = await checkPackages(allPackages, config, offline);

  const missing = results.filter((r) => r.exists === false);
  const unknown = results.filter((r) => r.exists === null);

  // A real package can still be a typosquat: a name one or two edits away from a
  // famous package (e.g. "reactt" vs "react"). Flag those that actually exist.
  const warnings = [];
  for (const r of results) {
    if (r.exists !== true) continue;
    const matches = await findTyposquats(r.name, r.ecosystem);
    for (const m of matches) {
      warnings.push({ name: r.name, ecosystem: r.ecosystem, similarTo: m.name, distance: m.distance });
    }
  }

  // Imports that are not declared in any manifest are a classic AI-slop signal.
  const manifestNames = new Set(allPackages.map((p) => p.name.toLowerCase()));
  const seenUndeclared = new Set();
  const undeclared = [];
  for (const imp of imports) {
    if (manifestNames.has(imp.name.toLowerCase())) continue;
    const key = `${imp.ecosystem}:${imp.name.toLowerCase()}`;
    if (seenUndeclared.has(key)) continue;
    seenUndeclared.add(key);
    undeclared.push(imp);
  }

  // Baseline: suppress findings we already acknowledged. `--write-baseline`
  // writes the current set and exits cleanly; `--baseline` filters the rest.
  if (flags.writeBaseline) {
    const file = await writeBaseline(root, missing, warnings, undeclared);
    if (!flags.quiet) console.log(`Wrote baseline to ${file} (${missing.length} not-found, ${warnings.length} typosquat, ${undeclared.length} undeclared)`);
    return 0;
  }
  const baseline = flags.baseline ? await loadBaseline(root) : null;
  const filtered = applyBaseline({ missing, warnings, undeclared }, baseline);

  const missOut = filtered.missing;
  const warnOut = filtered.warnings;
  const undOut = filtered.undeclared;

  if (flags.format === 'sarif') {
    console.log(JSON.stringify(toSarif(missOut, warnOut), null, 2));
    return missOut.length > 0 ? 1 : 0;
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          root,
          manifests,
          lockfiles,
          checked: results.length,
          suspicious: missOut.map((r) => ({ name: r.name, ecosystem: r.ecosystem, issue: 'not-found-in-registry' })),
          uncertain: unknown.map((r) => ({ name: r.name, ecosystem: r.ecosystem, reason: r.reason })),
          warnings: warnOut.map((w) => ({
            name: w.name,
            ecosystem: w.ecosystem,
            similarTo: w.similarTo,
            distance: w.distance,
          })),
          undeclaredImports: undOut.map((imp) => ({
            name: imp.name,
            ecosystem: imp.ecosystem,
            file: path.relative(root, imp.file),
          })),
        },
        null,
        2,
      ),
    );
    return missOut.length > 0 ? 1 : 0;
  }

  for (const r of missOut) {
    console.log(`NOT FOUND  [${r.ecosystem}] ${r.name}  <- not in the registry; possible hallucinated or typosquatted package`);
  }
  for (const r of unknown) {
    if (!flags.quiet) console.log(`UNCERTAIN  [${r.ecosystem}] ${r.name}  (${r.reason})`);
  }
  for (const imp of undOut) {
    const rel = path.relative(root, imp.file);
    console.log(`UNDECLARED  [${imp.ecosystem}] ${imp.name}  <- imported in ${rel} but not declared in any manifest`);
  }
  for (const w of warnOut) {
    console.log(`WARNING    [${w.ecosystem}] ${w.name}  -> similar to ${w.similarTo} (distance ${w.distance})`);
  }

  if (!flags.quiet) {
    const totalKnown = missing.length - missOut.length;
    if (missOut.length === 0 && undOut.length === 0) {
      const extra = baseline && totalKnown ? ` (${totalKnown} baseline finding(s) suppressed)` : '';
      console.log(`OK: all ${results.length} declared package(s) exist and every import is declared in a manifest.${extra}`);
    } else {
      if (missOut.length > 0) {
        console.log(`\n${missOut.length} declared package(s) not found in their registry. Verify each name before installing.`);
      }
      if (undOut.length > 0) {
        console.log(
          `${undOut.length} imported package(s) are not declared in any manifest. AI-generated code often imports packages that were never added to a manifest.`,
        );
      }
      if (warnOut.length > 0) {
        console.log(
          `${warnOut.length} declared package(s) look like a typo of a well-known package. Review the WARNING lines above before installing.`,
        );
      }
      if (baseline && totalKnown) {
        console.log(`${totalKnown} finding(s) from the baseline were suppressed.`);
      }
    }
  }

  return missOut.length > 0 ? 1 : 0;
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(command ? 0 : 2);
  }
  if (command === 'scan') {
    try {
      const code = await runScan(parseFlags(args.slice(1)));
      process.exit(code);
    } catch (err) {
      console.error(`slopguard: scan failed: ${err.message}`);
      process.exit(2);
    }
  }
  console.error(`slopguard: unknown command "${command}"\n\n${HELP}`);
  process.exit(2);
}

main();
