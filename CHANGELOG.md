# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [0.1.0] - 2026-08-23

### Added

- Initial release.
- `slopguard scan` CLI: finds `package.json` and `requirements*.txt` files and checks every declared dependency against the npm and PyPI registries.
- Exit code 1 when packages are missing from their registry, for use in CI.
- `--json` and `--quiet` output options.
- Zero third-party dependencies; Node.js 18+.
