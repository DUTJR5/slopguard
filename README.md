# slopguard

[![CI](https://github.com/DUTJR5/slopguard/actions/workflows/ci.yml/badge.svg)](https://github.com/DUTJR5/slopguard/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/DUTJR5/slopguard)](LICENSE)
[![npm version](https://img.shields.io/npm/v/slopguard)](https://www.npmjs.com/package/slopguard)

Catch hallucinated and typosquatted package names in AI-generated code — before they reach your lockfile.

AI coding assistants sometimes invent dependency names that don't exist. Attackers register those names on npm and PyPI and wait for someone to install them. This attack is called **slopsquatting**. slopguard checks every package your project declares or imports against the real registries, and flags the ones that shouldn't be there.

## Status

Actively developed. The CLI checks npm and PyPI manifests and source imports, detects typosquats, and ships as a GitHub Action (see [Use as a GitHub Action](#use-as-a-github-action)). Lockfile auditing, SARIF output, and more language support are on the [roadmap](#roadmap).

## Install

```bash
npm install -g slopguard
# or run without installing
npx slopguard scan .
```

Requires Node.js 18 or newer. No third-party dependencies.

## Usage

```bash
slopguard scan .          # scan the current directory
slopguard scan ./app      # scan a specific project
slopguard scan . --json   # machine-readable output
slopguard scan . --quiet  # only print suspicious packages
```

Example output:

```
Found 2 manifest(s), checking 47 package(s)...
NOT FOUND  [npm] react-dom-utils  <- not in the registry; possible hallucinated or typosquatted package

1 package(s) not found in their registry. Verify each name before installing.
```

Exit codes: `0` everything exists, `1` suspicious packages found (useful in CI), `2` usage or scan error.

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

- `package.json` dependencies (all four dependency fields)
- `requirements.txt` and `requirements-*.txt`
- Whether each name actually exists on npmjs.org / pypi.org

## Roadmap

- [x] npm / PyPI existence checks
- [x] Import statement scanning (JS, TS, Python) — catch hallucinated imports that never made it into a manifest
- [x] Typosquat detection (names one edit away from popular packages)
- [x] GitHub Action with PR comments
- [ ] Lockfile auditing (package-lock, yarn.lock, pnpm-lock, poetry.lock)
- [ ] SARIF output for GitHub code scanning
- [ ] Go and Rust support
- [ ] Config file, allowlist, baseline

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) (coming soon).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
