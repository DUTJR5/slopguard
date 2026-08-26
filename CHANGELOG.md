# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [0.3.0] - 2026-08-27

### Added

- Go support: `slopguard scan` now reads `go.mod` `require` blocks (module paths, including fenced blocks and `// indirect` lines) as the `go` ecosystem, checked against the Go module proxy at `https://proxy.golang.org/{module}/@v/list`. Uppercase letters in a module path are escaped per Go's convention (prefix `!` + lowercase, e.g. `github.com/Shopify/go-que` -> `github.com/!shopify/go-que`). `go.sum` lockfiles are also parsed.
- Rust support: `slopguard scan` reads `Cargo.toml` `[dependencies]` / `[dev-dependencies]` section keys (and `[dependencies.foo]` sub-tables) as the `rust` ecosystem, checked against the crates.io API at `https://crates.io/api/v1/crates/{name}` (a `user-agent` header is always sent, as crates.io requires one). `Cargo.lock` is also parsed. All five ecosystems (npm, PyPI, RubyGems, Go, Rust) are now wired into the scan flow and the `--json` output.
- Risk scoring: a new `src/risk.js` grades every package that exists in its registry, not just whether it exists. Signals: package age < 30 days (+2), npm weekly downloads < 100 (+1; PyPI has no public download-count API so this signal is npm-only and noted in a code comment), name within edit distance of a well-known package (+2), and imported but never declared in a manifest (+1). A total >= 3 is flagged `HIGH RISK`. Text output prints each suspicious package's score and the signals that fired; `--json` carries a `risk` array with `score`, `level` and `signals` per package. Risk scoring does not change the exit code (only missing packages fail CI).
- Response cache: a new `src/cache.js` writes `.slopguard-cache.json` into the scanned directory, keyed by `ecosystem:packageName` and holding the existence verdict plus the registry metadata used for risk scoring, with a 24-hour TTL. The cache is consulted before any network request and shared with the risk-scoring metadata lookups, so repeat scans (and the daily re-scan of a large repo) cost almost nothing. `--no-cache` disables it. `.gitignore` now ignores `.slopguard-cache.json`.
- Performance benchmark: `scripts/benchmark.mjs` builds a throwaway project declaring 100 real, existing npm packages, then times a `scan` run cold (no cache) and warm (cache reused) through the proxy, writing the real durations, package count and cache hit rate into `docs/benchmarks.md`. Measured result on this machine: cold 22.38s (100 network fetches) vs warm 0.34s (100% cache hit rate, 0 fetches).
- HTML report: `slopguard scan --format html` writes a self-contained `slopguard-report.html` (inline CSS, no external dependencies) into the scanned directory. It shows a summary of packages checked and issue counts, plus a detail table where NOT FOUND findings are marked red and typosquat WARNING findings are marked yellow. The file path is printed to the terminal.
- Community files: `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml` (GitHub issue forms), `.github/pull_request_template.md`, and `CONTRIBUTING.md` describing how to run the tests, the commit message format, and the PR flow.

## [0.2.0] - 2026-08-25

### Added

- Config file and private registry support: `slopguard scan` now reads `slopguard.config.json` from the scanned directory. It supports `allowlist` (skip every check for listed package names — for private/internal packages), `ignoreEcosystems` (skip a whole ecosystem, e.g. `["pypi"]`), `offline` (no network requests; only local typosquat checks run and packages are reported as uncertain instead of failed), and `registries` (override the npm/PyPI/RubyGems base URLs). Private npm mirrors use the same `/{name}` path with `%2f` for scoped packages; a private PyPI base ending in `/simple` (PEP 503 index, no JSON API) is probed with a plain `GET {url}/{name}/` and a 200/404 response.
- Baseline support: `slopguard scan --write-baseline` snapshots the current findings to `slopguard-baseline.json`; later runs with `--baseline` suppress those findings from the report and from the exit code, while new findings still report and still fail CI.
- GitHub Action: the repository now ships `action.yml`, a composite action that runs `slopguard scan` on Node 20. Inputs are `path` (default `.`) and `fail-on-findings` (default `true`). On a pull request it posts a comment listing any suspicious, typosquatted, or undeclared packages; on a push it just runs the scan. The project dogfoods the action via `.github/workflows/slopguard.yml`.
- Release automation: `.github/workflows/release.yml` creates a GitHub Release when a `v*` tag is pushed. The release body is extracted from the matching version section of `CHANGELOG.md` by `scripts/extract-changelog.mjs`.
- Source-import scanning: `slopguard scan` now also reads `import`/`require`/`import()` (JS/TS) and `import`/`from` (Python) statements from `.js`/`.jsx`/`.ts`/`.tsx`/`.py` files and flags packages that are imported but never declared in any manifest (`not declared in any manifest`). Use `--no-imports` to restrict the scan to manifest dependencies only.
- Typosquat detection: for every package that exists in its registry, `slopguard scan` now compares the name against a built-in list of the most popular npm and PyPI packages using the Levenshtein edit distance. A name one or two edits away from a famous package (e.g. `reactt` ≈ `react`, `lodahs` ≈ `lodash`) prints a `WARNING [ecosystem] name -> similar to famous` line and appears in the `--json` `warnings` array. Short names (< 5 chars) are only flagged at distance 1 to keep false positives down.
- Lockfile auditing: `slopguard scan` now also parses lockfiles and folds their packages into the scan. Supported formats: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` (npm), `poetry.lock` (PyPI), and `Gemfile.lock` (RubyGems). No third-party parsers — `package-lock.json` is read as JSON and the rest are parsed with small line scanners. Results are de-duplicated with manifest dependencies by `ecosystem:name`.
- SARIF output: `slopguard scan --format sarif` emits a SARIF 2.1.0 document (code-scanning compatible) with two rules — `slopguard/not-found-in-registry` (level `error`) and `slopguard/possible-typosquat` (level `warning`). The `--format` flag accepts `text` (default), `json`, or `sarif`.
- Ruby support: `Gemfile` dependencies are read via `gem 'name'` lines (ecosystem `rubygems`) and `Gemfile.lock` specs are parsed. RubyGems existence is checked at `https://rubygems.org/api/v1/gems/{name}.json` (200 / 404). A `rubygems` list of ~60 well-known gems was added to `src/data/top-packages.json`, so typosquat detection now covers RubyGems too.

## [0.1.0] - 2026-08-23

### Added

- Initial release.
- `slopguard scan` CLI: finds `package.json` and `requirements*.txt` files and checks every declared dependency against the npm and PyPI registries.
- Exit code 1 when packages are missing from their registry, for use in CI.
- `--json` and `--quiet` output options.
- Zero third-party dependencies; Node.js 18+.
