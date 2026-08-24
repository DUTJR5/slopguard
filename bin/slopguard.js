#!/usr/bin/env node

import path from 'node:path';
import { collectDependencies } from '../src/manifests.js';
import { collectImports } from '../src/imports.js';
import { checkPackages } from '../src/registry.js';

const args = process.argv.slice(2);
const command = args[0];

const HELP = `slopguard - catch hallucinated and typosquatted dependencies

Usage:
  slopguard scan [path] [--json] [--quiet] [--no-imports]

Commands:
  scan [path]   Scan manifests and source imports under [path] (default: current directory)

Options:
  --json        Print results as JSON
  --quiet       Only print suspicious packages
  --no-imports  Skip source-import scanning; only check manifest dependencies
  --help        Show this help

Exit codes:
  0  all declared packages exist in their registry
  1  one or more packages were NOT found (possible hallucination / typosquat)
  2  usage error or scan failure
`;

function parseFlags(rest) {
  return {
    path: rest.find((a) => !a.startsWith('--')) || '.',
    json: rest.includes('--json'),
    quiet: rest.includes('--quiet'),
    noImports: rest.includes('--no-imports'),
  };
}

async function runScan(flags) {
  const root = path.resolve(flags.path);
  const { packages, manifests } = await collectDependencies(root);

  let imports = [];
  if (!flags.noImports) {
    const found = await collectImports(root);
    imports = found.imports;
  }

  if (packages.length === 0 && imports.length === 0) {
    const msg = `No dependency manifests or source imports found under ${root}`;
    if (flags.json) {
      console.log(
        JSON.stringify({ root, manifests: [], packages: [], suspicious: [], undeclaredImports: [] }, null, 2),
      );
    } else {
      console.log(msg);
    }
    return 0;
  }

  if (!flags.quiet && !flags.json) {
    const bits = [`${manifests.length} manifest(s), ${packages.length} declared package(s)`];
    if (!flags.noImports) bits.push(`${imports.length} source import(s)`);
    console.log(`Scanning ${bits.join(', ')} under ${root}...`);
  }

  const results = await checkPackages(packages);

  const missing = results.filter((r) => r.exists === false);
  const unknown = results.filter((r) => r.exists === null);

  // Imports that are not declared in any manifest are a classic AI-slop signal.
  const manifestNames = new Set(packages.map((p) => p.name.toLowerCase()));
  const seenUndeclared = new Set();
  const undeclared = [];
  for (const imp of imports) {
    if (manifestNames.has(imp.name.toLowerCase())) continue;
    const key = `${imp.ecosystem}:${imp.name.toLowerCase()}`;
    if (seenUndeclared.has(key)) continue;
    seenUndeclared.add(key);
    undeclared.push(imp);
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          root,
          manifests,
          checked: results.length,
          suspicious: missing.map((r) => ({ name: r.name, ecosystem: r.ecosystem, issue: 'not-found-in-registry' })),
          uncertain: unknown.map((r) => ({ name: r.name, ecosystem: r.ecosystem, reason: r.reason })),
          undeclaredImports: undeclared.map((imp) => ({
            name: imp.name,
            ecosystem: imp.ecosystem,
            file: path.relative(root, imp.file),
          })),
        },
        null,
        2,
      ),
    );
    return missing.length > 0 ? 1 : 0;
  }

  for (const r of missing) {
    console.log(`NOT FOUND  [${r.ecosystem}] ${r.name}  <- not in the registry; possible hallucinated or typosquatted package`);
  }
  for (const r of unknown) {
    if (!flags.quiet) console.log(`UNCERTAIN  [${r.ecosystem}] ${r.name}  (${r.reason})`);
  }
  for (const imp of undeclared) {
    const rel = path.relative(root, imp.file);
    console.log(`UNDECLARED  [${imp.ecosystem}] ${imp.name}  <- imported in ${rel} but not declared in any manifest`);
  }

  if (!flags.quiet) {
    if (missing.length === 0 && undeclared.length === 0) {
      console.log(`OK: all ${results.length} declared package(s) exist and every import is declared in a manifest.`);
    } else {
      if (missing.length > 0) {
        console.log(`\n${missing.length} declared package(s) not found in their registry. Verify each name before installing.`);
      }
      if (undeclared.length > 0) {
        console.log(
          `${undeclared.length} imported package(s) are not declared in any manifest. AI-generated code often imports packages that were never added to a manifest.`,
        );
      }
    }
  }

  return missing.length > 0 ? 1 : 0;
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
