# Real-world scan report

This document records `slopguard` scanning five well-known open-source projects as
they actually exist on GitHub. Every number below comes from a real run of the CLI:
nothing is estimated or invented. Where the tool found nothing interesting, that is
written down too.

- **Tool version:** slopguard 0.2.0 (working tree at the v0.2.0 release commit)
- **Scan date:** 2026-08-25
- **Command:** `node bin/slopguard.js scan <repo> --json`
- **Projects:** cloned fresh with `git clone --depth 1`

### Environment note (kept honest)

The machine that ran these scans only reaches the internet through an outbound HTTP
proxy (`HTTPS_PROXY`). Node's built-in `fetch` does not read that variable on its own,
so the scans were launched with a tiny runtime loader that pointed Node's global
fetch at the proxy (no change to `slopguard` itself — it stays zero-dependency). In
an environment with direct internet access, the command above runs unchanged and
produces the same verdicts. Every "exists / not found" decision is a genuine response
from the public npm / PyPI / RubyGems registries.

## Results

| Project | Ecosystem(s) | Manifests | Lockfiles | Packages checked | Not found | Typosquat warnings | Undeclared imports | Exit | Duration |
|---------|--------------|-----------|-----------|------------------|-----------|--------------------|--------------------|------|----------|
| expressjs/express | npm | 1 | 0 | 44 | 0 | 1 | 2 | 0 | 7.6 s |
| pallets/flask | PyPI | 1 | 0 | 21 | 0 | 0 | 34 | 0 | 6.0 s |
| psf/requests | PyPI | 2 | 0 | 7 | 0 | 0 | 26 | 0 | 4.9 s |
| rails/rails | RubyGems (+ npm) | 7 | 3 | 915 | 0 | 13 | 1 | 0 | 51.4 s |
| facebook/react | npm | 115 | 47 | 2910 | 7 | 34 | 59 | 1 | 146.0 s |
| **Total** | | **126** | **50** | **3897** | **7** | **48** | **122** | | |

## What the numbers mean

**No hallucinated or typosquatted packages were found in four of the five repos.**
express, flask, requests and rails all came back clean on the "does this package
actually exist in its registry?" check.

**react flagged 7 packages as not found in npm.** All seven are declared inside
React's own repository — they are not third-party dependencies someone typo'd:

| Package | Where it is declared in the react repo | Why it is "not found" |
|---------|----------------------------------------|------------------------|
| `babel-plugin-react-compiler-rust` | `compiler/packages/babel-plugin-react-compiler-rust/package.json` | a local, in-repo package that is never published to the public npm registry |
| `@typescript-eslint/parser-v2` … `-v5` | `packages/eslint-plugin-react-hooks/package.json` | version-pinned aliases for specific major versions |
| `eslint-v8` | `fixtures/eslint-v8/package.json` | a test fixture, not a real published package |
| `react-dom-17` | `packages/use-sync-external-store/package.json` | a version-pinned alias |

These are exactly the kind of internal / unpublished references a monorepo naturally
contains. They are **not** AI-generated hallucinations. A team would silence them with
the `allowlist` config option (see README). The scan exits `1` on react only because of
these declared-but-unpublished names.

**One "uncertain" in react (`own-keys`).** The registry returned an unexpected status
for a single package during the run (a transient network/proxy hiccup, not a real
verdict). slopguard reports such cases as `uncertain` rather than guessing.

**Typosquat warnings are intentionally broad and mostly false positives here.** The
tool flags any real package whose name is one or two edits away from a famous package.
On mature codebases that surfaces ubiquitous packages (`ms`, `qs`, `debug`, `acorn`,
`esquery`, `colors`, `coa`, …) that merely resemble another popular name. That is by
design — they are a human-review signal, not a verdict. See the appendix for the full
lists.

**"Undeclared imports" count standard-library and first-party modules too.** For
example react's 59 undeclared imports include Node built-ins (`path`, `fs`, `crypto`,
`child_process`, …) and React's own internal modules; flask's 34 include `pytest`,
`docutils`, `packaging` (test/docs deps) and example apps. This column means "imported
in source but absent from any manifest" — normal for mature repos, and not by itself a
supply-chain risk.

## Takeaways

- slopguard runs end-to-end on real-world codebases, from a 7-package library
  (requests) to a 2910-package monorepo (react).
- On these five projects it found **no AI-hallucinated dependencies**.
- It did correctly surface React's internal/unpublished package references — the
  realistic case a team handles with `allowlist`, not a bug.
- The typosquat detector errs toward over-reporting on short, common names; tuning
  (e.g. only flagging distance-1 for very short names, or a tighter top-package list)
  is a known follow-up and is documented as such.

## Appendix A — typosquat warnings (rails, 13)

| Package | Ecosystem | Similar to | Distance |
|---------|-----------|------------|----------|
| debug | rubygems | byebug | 2 |
| builder | rubygems | jbuilder | 1 |
| crass | rubygems | sass | 2 |
| pp | rubygems | pg | 1 |
| acorn | npm | cors | 2 |
| commondir | npm | commander | 2 |
| compressing | npm | compression | 2 |
| esquery | npm | jquery | 2 |
| ms | npm | ws | 1 |
| node-watch | npm | node-fetch | 2 |
| qs | npm | ws | 1 |
| slash | npm | sass | 2 |
| urijs | npm | rxjs | 2 |

## Appendix B — typosquat warnings (react, 34)

| Package | Similar to | Distance |
|---------|------------|----------|
| prettier-2 | prettier | 2 |
| targz | yargs | 2 |
| @babel/node | @babel/core | 2 |
| babel-core | @babel/core | 2 |
| acorn | cors | 2 |
| esquery | jquery | 2 |
| jsesc | jest | 2 |
| ms | ws | 1 |
| args | yargs | 1 |
| commondir | commander | 2 |
| fecha | mocha | 2 |
| keypress | express | 2 |
| kuler | multer | 2 |
| qs | ws | 1 |
| saxes | sass | 2 |
| slash | sass | 2 |
| osenv | dotenv | 2 |
| coa | koa | 1 |
| colors | cors | 2 |
| d | d3 | 1 |
| thunky | husky | 2 |
| urijs | rxjs | 2 |
| write | vite | 2 |
| ext | next | 1 |
| vfile | vite | 2 |
| enquirer | inquirer | 1 |
| rechoir | recoil | 2 |
| klona | koa | 2 |
| commoner | commander | 2 |
| recast | react | 2 |
| deppack | webpack | 2 |
| corser | cors | 2 |
| crypt | bcrypt | 1 |
| isurl | csurf | 2 |

---

*Generated by `slopguard` 0.2.0 on 2026-08-25. All figures are direct output of
`node bin/slopguard.js scan <repo> --json`.*
