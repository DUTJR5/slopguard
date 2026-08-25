# slopguard

[![CI](https://github.com/DUTJR5/slopguard/actions/workflows/ci.yml/badge.svg)](https://github.com/DUTJR5/slopguard/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/DUTJR5/slopguard)](LICENSE)
[![npm version](https://img.shields.io/npm/v/slopguard)](https://www.npmjs.com/package/slopguard)

Catch hallucinated and typosquatted package names in AI-generated code — before they reach your lockfile.

AI coding assistants sometimes invent dependency names that don't exist. Attackers register those names on npm and PyPI and wait for someone to install them. This attack is called **slopsquatting**. slopguard checks every package your project declares or imports against the real registries, and flags the ones that shouldn't be there.

## Status

Actively developed. The CLI scans npm, PyPI, RubyGems, Go and Rust manifests, lockfiles and source imports, detects typosquats, scores existing packages by risk, supports a config file and baseline, emits SARIF, and ships as a GitHub Action (see [Use as a GitHub Action](#use-as-a-github-action)).

## Install

```bash
npm install -g slopguard
# or run without installing
npx slopguard scan .
```

Requires Node.js 18 or newer. No third-party dependencies.

## Usage

```bash
slopguard scan .                 # scan the current directory
slopguard scan ./app             # scan a specific project
slopguard scan . --json          # machine-readable JSON output
slopguard scan . --quiet         # only print suspicious packages
slopguard scan . --format sarif  # SARIF 2.1.0 output for code scanning
slopguard scan . --no-imports    # only check manifest + lockfile deps
slopguard scan . --offline       # no network; only local typosquat checks
slopguard scan . --write-baseline  # snapshot current findings, exit 0
slopguard scan . --baseline      # suppress already-acknowledged findings
slopguard scan . --config ./slopguard.config.json  # custom config path
```

All options:

| Option | Effect |
|--------|--------|
| `--format <fmt>` | Output format: `text` (default), `json`, or `sarif`. |
| `--json` | Alias for `--format json`. |
| `--quiet` | Only print suspicious packages (not-found, undeclared, warnings). |
| `--no-imports` | Skip source-import scanning; only check manifest + lockfile dependencies. |
| `--offline` | No network requests; only local typosquat checks run. Packages are reported as uncertain, not failed. |
| `--config <file>` | Path to a config file (default: `<path>/slopguard.config.json`). |
| `--write-baseline` | Write the current findings to `slopguard-baseline.json` and exit `0`. |
| `--baseline` | Suppress findings already listed in `slopguard-baseline.json` (and from the exit code). |
| `--no-cache` | Do not read or write the on-disk response cache (`.slopguard-cache.json`). |
| `--help`, `-h` | Show the help text. |

Example output:

```
Scanning 2 manifest(s), 47 declared package(s) from 5 file(s), 12 source import(s) under /app...
NOT FOUND  [npm] react-dom-utils  <- not in the registry; possible hallucinated or typosquatted package

1 declared package(s) not found in their registry. Verify each name before installing.
```

Exit codes: `0` everything exists (or was suppressed by a baseline), `1` suspicious packages found (useful in CI), `2` usage or scan error.

## Use as a GitHub Action

slopguard can run as a GitHub Action. On a pull request it posts a comment listing any suspicious packages it finds; on a push it just runs the scan.

```yaml
# .github/workflows/slopguard.yml
name: slopguard
on: [pull_request]
jobs:
  slopguard:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: DUTJR5/slopguard@v0.2
        with:
          path: .
          fail-on-findings: true
```

Set `fail-on-findings: false` to report findings without failing the build. Inputs:

- `path` — directory to scan (default `.`)
- `fail-on-findings` — fail the action when suspicious packages are found (default `true`)

## What it checks

For every name it finds, slopguard asks the real registry whether the package exists, and (for packages that do exist) whether the name is suspiciously close to a well-known package.

**Manifests**

- npm: `package.json` — all four dependency fields (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`).
- PyPI: `requirements.txt` and `requirements-*.txt`.
- RubyGems: `Gemfile` (`gem 'name'` lines).
- Go: `go.mod` — module paths in `require` blocks (checked against the Go module proxy; uppercase letters are escaped per Go's convention, e.g. `github.com/Shopify/go-que` → `github.com/!shopify/go-que`).
- Rust: `Cargo.toml` — keys in `[dependencies]` / `[dev-dependencies]` (checked against the crates.io API).

**Lockfiles** (folded into the scan, de-duplicated with manifests)

- npm: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`.
- PyPI: `poetry.lock`.
- RubyGems: `Gemfile.lock`.
- Go: `go.sum`.
- Rust: `Cargo.lock`.

**Source imports**

- JavaScript / TypeScript: `import` / `require` / `import()` in `.js`, `.jsx`, `.ts`, `.tsx`.
- Python: `import` / `from` in `.py`.

Packages that are imported but never declared in any manifest are flagged as `UNDECLARED`. Comments are stripped before import scanning to avoid false positives.

**Typosquat detection**

For every package that exists in its registry, the name is compared against a built-in list of the most popular npm, PyPI and RubyGems packages using the Levenshtein edit distance. A name one or two edits away from a famous package prints a `WARNING`. Short names (< 5 chars) are only flagged at distance 1 to keep false positives down.

**Risk scoring**

"Exists" is only the first question. Every package that *does* exist is still graded so a real but freshly-created, barely-downloaded, look-alike package stands out. Signals:

- package registered **< 30 days ago** → +2
- (npm only) **weekly downloads < 100** → +1 — PyPI has no public download-count API, so this signal is npm-only
- name resembles a well-known package (typosquat) → +2
- imported in source but never declared in a manifest → +1

Total **≥ 3** is printed as `HIGH RISK`. Risk findings are reported but do not change the exit code (only missing packages fail CI). Risk metadata is reused from the response cache, so it costs no extra network requests.

## Roadmap

- [x] npm / PyPI existence checks
- [x] Import statement scanning (JS, TS, Python) — catch hallucinated imports that never made it into a manifest
- [x] Typosquat detection (names close to popular packages)
- [x] GitHub Action with PR comments
- [x] Lockfile auditing (package-lock, yarn.lock, pnpm-lock, poetry.lock, Gemfile.lock)
- [x] SARIF output for GitHub code scanning
- [x] RubyGems support
- [x] Config file, allowlist, baseline, private registry support
- [x] Go and Rust support (`go.mod` / `go.sum`, `Cargo.toml` / `Cargo.lock`)
- [x] Risk scoring from registry metadata (package age, download volume, typosquat resemblance, undeclared imports)
- [x] Response cache (`.slopguard-cache.json`, 24h TTL) to skip repeat registry requests

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) (coming soon).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
