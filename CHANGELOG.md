# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Source-import scanning: `slopguard scan` now also reads `import`/`require`/`import()` (JS/TS) and `import`/`from` (Python) statements from `.js`/`.jsx`/`.ts`/`.tsx`/`.py` files and flags packages that are imported but never declared in any manifest (`not declared in any manifest`). Use `--no-imports` to restrict the scan to manifest dependencies only.

## [0.1.0] - 2026-08-23

### Added

- Initial release.
- `slopguard scan` CLI: finds `package.json` and `requirements*.txt` files and checks every declared dependency against the npm and PyPI registries.
- Exit code 1 when packages are missing from their registry, for use in CI.
- `--json` and `--quiet` output options.
- Zero third-party dependencies; Node.js 18+.
