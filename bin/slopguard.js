#!/usr/bin/env node

import path from 'node:path';
import { collectDependencies } from '../src/manifests.js';
import { checkPackages } from '../src/registry.js';

const args = process.argv.slice(2);
const command = args[0];

const HELP = `slopguard - catch hallucinated and typosquatted dependencies

Usage:
  slopguard scan [path] [--json] [--quiet]

Commands:
  scan [path]   Scan manifests under [path] (default: current directory)

Options:
  --json        Print results as JSON
  --quiet       Only print suspicious packages
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
  };
}

async function runScan(flags) {
  const root = path.resolve(flags.path);
  const { packages, manifests } = await collectDependencies(root);

  if (packages.length === 0) {
    const msg = `No dependency manifests found under ${root}`;
    if (flags.json) {
      console.log(JSON.stringify({ root, manifests: [], packages: [], suspicious: [] }, null, 2));
    } else {
      console.log(msg);
    }
    return 0;
  }

  if (!flags.quiet && !flags.json) {
    console.log(`Found ${manifests.length} manifest(s), checking ${packages.length} package(s)...`);
  }

  const results = await checkPackages(packages);
  const missing = results.filter((r) => r.exists === false);
  const unknown = results.filter((r) => r.exists === null);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          root,
          manifests,
          checked: results.length,
          suspicious: missing.map((r) => ({ name: r.name, ecosystem: r.ecosystem, issue: 'not-found-in-registry' })),
          uncertain: unknown.map((r) => ({ name: r.name, ecosystem: r.ecosystem, reason: r.reason })),
        },
        null,
        2,
      ),
    );
  } else {
    for (const r of missing) {
      console.log(`NOT FOUND  [${r.ecosystem}] ${r.name}  <- not in the registry; possible hallucinated or typosquatted package`);
    }
    for (const r of unknown) {
      if (!flags.quiet) console.log(`UNCERTAIN  [${r.ecosystem}] ${r.name}  (${r.reason})`);
    }
    if (missing.length === 0) {
      console.log(`OK: all ${results.length} package(s) exist in their registry.`);
    } else {
      console.log(`\n${missing.length} package(s) not found in their registry. Verify each name before installing.`);
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
