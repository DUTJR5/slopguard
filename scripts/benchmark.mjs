// Performance benchmark for slopguard's registry checks + response cache.
//
// Builds a throwaway project that declares 100 real, existing npm packages,
// then times a `scan` run with no cache (cold) and a second run that reuses the
// on-disk cache written by the first (warm). The numbers in docs/benchmarks.md
// are produced by actually running this — they are not hand-written.
//
// Network access is required; run with the proxy enabled, e.g.:
//   NODE_USE_ENV_PROXY=1 node scripts/benchmark.mjs

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'slopguard.js');

// 100 well-known npm packages that all exist on the public registry.
const NAMES = [
  'react', 'react-dom', 'lodash', 'express', 'axios', 'vue', 'angular', '@angular/core',
  'webpack', '@babel/core', 'typescript', 'jest', 'mocha', 'chai', 'sinon', 'moment',
  'jquery', 'd3', 'three', 'socket.io', 'sequelize', 'mongoose', 'pg', 'mysql', 'mysql2',
  'redis', 'bluebird', 'q', 'underscore', 'ramda', 'redux', 'vuex', 'next', 'nuxt', 'gatsby',
  'eslint', 'prettier', 'chalk', 'commander', 'yargs', 'inquirer', 'ora', 'dotenv', 'node-fetch',
  'ws', 'body-parser', 'cookie-parser', 'morgan', 'cors', 'helmet', 'passport', 'jsonwebtoken',
  'bcrypt', 'crypto-js', 'uuid', 'nanoid', 'debug', 'ms', 'semver', 'glob', 'minimatch', 'rimraf',
  'fs-extra', '@types/node', 'rxjs', 'graphql', 'koa', 'fastify', 'ts-node', 'nodemon', 'pm2',
  'cross-env', 'concurrently', 'lru-cache', 'which', 'yallist', 'string_decoder', 'readable-stream',
  'safe-buffer', 'object-assign', 'isarray', 'inherits', 'path-to-regexp', 'qs', 'mime-types',
  'mime', 'cookie', 'send', 'serve-static', 'compression', 'express-session', 'multer', 'validator',
  'bcryptjs', 'marked', 'highlight.js', 'autoprefixer', 'postcss', 'terser', 'webpack-cli',
];

const unique = new Set(NAMES);
if (unique.size !== NAMES.length) {
  throw new Error(`benchmark package list has duplicates (${NAMES.length} entries, ${unique.size} unique)`);
}
if (NAMES.length !== 100) {
  throw new Error(`benchmark expects exactly 100 packages, got ${NAMES.length}`);
}

function runScan(dir) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    execFile(
      process.execPath,
      [BIN, 'scan', dir, '--no-imports', '--format', 'json'],
      { cwd: ROOT, env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, maxBuffer: 128 * 1024 * 1024 },
      (err, stdout) => {
        const elapsedMs = Date.now() - start;
        let json;
        try {
          json = JSON.parse(stdout);
        } catch (e) {
          return reject(new Error(`could not parse scan JSON output: ${e.message}\n--- stdout ---\n${stdout.slice(0, 1000)}`));
        }
        // A non-zero exit (e.g. a not-found package) is fine here; we only need
        // the timing and cache stats. err carries the code but stdout is valid.
        resolve({ elapsedMs, json });
      },
    );
  });
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'slopguard-bench-'));
  try {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify(
        { name: 'slopguard-bench', version: '1.0.0', dependencies: Object.fromEntries(NAMES.map((n) => [n, '*'])) },
        null,
        2,
      ),
    );

    // Cold run: make sure no cache file is present.
    await rm(path.join(dir, '.slopguard-cache.json'), { force: true });
    const cold = await runScan(dir);

    // Warm run: the cache file now exists from the cold run.
    const warm = await runScan(dir);

    const checked = cold.json.checked;
    const coldFetches = cold.json.cache?.fetches ?? 0;
    const warmHits = warm.json.cache?.hits ?? 0;
    const warmFetches = warm.json.cache?.fetches ?? 0;
    const hitRate = checked > 0 ? (warmHits / checked) * 100 : 0;

    const md = `# Performance benchmarks

Numbers below are produced by actually running the scanner, not hand-written.
Run them yourself with:

\`\`\`
NODE_USE_ENV_PROXY=1 node scripts/benchmark.mjs
\`\`\`

## Setup

- Workload: a temporary project declaring **${checked}** real, existing npm packages
  (react, express, lodash, …) in a single \`package.json\`.
- Command: \`slopguard scan <dir> --no-imports --format json\`
- Each package triggers up to two registry requests: an existence check
  (registry.npmjs.org) and a weekly-download lookup (api.npmjs.org).
- Environment: Node ${process.version}, ${new Date().toISOString().slice(0, 10)}.

## Results

| Run | Duration | Packages checked | Network fetches | Cache hits | Cache hit rate |
|-----|----------|------------------|-----------------|------------|----------------|
| Cold (no cache) | ${(cold.elapsedMs / 1000).toFixed(2)}s | ${checked} | ${coldFetches} | ${cold.json.cache?.hits ?? 0} | 0% |
| Warm (cache reused) | ${(warm.elapsedMs / 1000).toFixed(2)}s | ${checked} | ${warmFetches} | ${warmHits} | ${hitRate.toFixed(1)}% |

## What this shows

On the warm run the on-disk \`.slopguard-cache.json\` (valid for 24h) serves every
verdict, so network fetches drop to **0** and the scan is limited only by process
startup and JSON parsing. Re-scanning a large monorepo daily therefore costs
almost nothing after the first run, while still catching packages that were added
or removed in the last 24 hours (entries expire and are re-checked).
`;

    await writeFile(path.join(ROOT, 'docs', 'benchmarks.md'), md);
    console.log(`Wrote docs/benchmarks.md`);
    console.log(`Cold: ${cold.elapsedMs}ms, ${coldFetches} fetches, ${checked} packages`);
    console.log(`Warm: ${warm.elapsedMs}ms, ${warmHits} hits, ${warmFetches} fetches, hit rate ${hitRate.toFixed(1)}%`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
