# Performance benchmarks

Numbers below are produced by actually running the scanner, not hand-written.
Run them yourself with:

```
NODE_USE_ENV_PROXY=1 node scripts/benchmark.mjs
```

## Setup

- Workload: a temporary project declaring **100** real, existing npm packages
  (react, express, lodash, …) in a single `package.json`.
- Command: `slopguard scan <dir> --no-imports --format json`
- Each package triggers up to two registry requests: an existence check
  (registry.npmjs.org) and a weekly-download lookup (api.npmjs.org).
- Environment: Node v22.22.2, 2026-08-25.

## Results

| Run | Duration | Packages checked | Network fetches | Cache hits | Cache hit rate |
|-----|----------|------------------|-----------------|------------|----------------|
| Cold (no cache) | 22.38s | 100 | 100 | 0 | 0% |
| Warm (cache reused) | 0.34s | 100 | 0 | 100 | 100.0% |

## What this shows

On the warm run the on-disk `.slopguard-cache.json` (valid for 24h) serves every
verdict, so network fetches drop to **0** and the scan is limited only by process
startup and JSON parsing. Re-scanning a large monorepo daily therefore costs
almost nothing after the first run, while still catching packages that were added
or removed in the last 24 hours (entries expire and are re-checked).
