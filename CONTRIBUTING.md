# Contributing to slopguard

Thanks for taking the time to contribute. This project is small and intentionally zero-dependency, so the bar for changes is low but specific.

## Getting started

You need Node.js 18 or newer. Clone the repo and you're ready — there are no third-party packages to install.

```bash
git clone https://github.com/DUTJR5/slopguard
cd slopguard
```

## Running the tests

Tests use Node's built-in runner (`node:test`). No setup needed:

```bash
node --test
```

All tests must pass before a change is considered done. If you add a feature or fix a bug, add a test that covers it. Test files live in `test/` and import from `src/`.

## Commit messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) style, in English, one short sentence:

- `feat:` a new feature
- `fix:` a bug fix
- `docs:` documentation only
- `test:` adding or updating tests
- `chore:` housekeeping (release, refactoring with no behavior change)

Examples:

```
feat: add Go module proxy support
fix: skip comment lines in import scan
chore: release v0.3.0
```

## Pull requests

1. Fork and create a branch from `main`.
2. Make your change, with tests.
3. Run `node --test` and confirm everything passes.
4. Add a note to the `Unreleased` section of `CHANGELOG.md` (keep it one line, say what changed and why).
5. Open the PR using the pull request template — fill in the change description, testing status, and the CHANGELOG checkbox.

## A few guardrails

- **No third-party dependencies.** The whole CLI runs on Node's standard library. If you think a dependency is necessary, open an issue first to discuss it.
- **No fabricated data.** Don't invent numbers (download counts, star counts, scan results). Anything reported must come from a real run.
- **Keep docs plain.** Write documentation in straightforward language.

## Reporting security issues

Please don't open a public issue for security problems. See `SECURITY.md` for the private reporting path.
