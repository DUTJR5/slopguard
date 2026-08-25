// Risk scoring turns a "this package exists" verdict into "how suspicious is
// it". The basic check only answers yes/no; risk scoring adds cheap, registry-
// derived signals plus two local signals so a real but freshly-created, barely
// downloaded, look-alike package stands out.
//
// Signals and points:
//   +2  package registered < 30 days ago          (fresh packages are a common
//                                                   supply-chain attack vector)
//   +1  npm weekly downloads < 100                 (tiny audience = easy to slip
//                                                   past unnoticed)
//   +2  name is within edit distance of a famous  (typosquat)
//        package (computed by src/typosquat.js)
//   +1  imported in source but never declared in  (classic AI-slop pattern)
//        any manifest
//
// Total >= 3 => HIGH RISK. Everything > 0 is reported; 0 is clean.
//
// Metadata comes from src/registry.js and is the normalized object
// `{ createdAt, downloadsLastWeek }` (both nullable). When a registry exposes
// no created-at (e.g. Go's proxy) or no weekly downloads (PyPI, RubyGems,
// crates.io), that signal is simply skipped rather than faked.

const YOUNG_PACKAGE_DAYS = 30;
const LOW_DOWNLOADS = 100;

/**
 * Compute a risk score for a package.
 *
 * @param {object} args
 * @param {string} args.name
 * @param {'npm'|'pypi'|'rubygems'|'go'|'rust'} args.ecosystem
 * @param {{createdAt?: number|null, downloadsLastWeek?: number|null}|null} [args.metadata]
 * @param {boolean} [args.typosquatHit]  name matched a well-known package
 * @param {boolean} [args.undeclared]    imported but not declared in a manifest
 * @returns {{score: number, signals: string[], level: 'HIGH RISK'|'elevated'|'ok'}}
 */
export function computeRisk({ name, ecosystem, metadata = null, typosquatHit = false, undeclared = false } = {}) {
  const signals = [];
  let score = 0;

  // Age signal — available wherever the registry exposes a creation time.
  if (metadata && typeof metadata.createdAt === 'number') {
    const ageDays = (Date.now() - metadata.createdAt) / 86400000;
    if (ageDays < YOUNG_PACKAGE_DAYS) {
      score += 2;
      signals.push(`package registered ${Math.max(0, Math.round(ageDays))} day(s) ago (< ${YOUNG_PACKAGE_DAYS})`);
    }
  }

  // Download signal — npm only. PyPI/RubyGems/crates.io have no public weekly
  // download API, so we never set downloadsLastWeek for them and this is skipped.
  if (ecosystem === 'npm' && metadata && typeof metadata.downloadsLastWeek === 'number') {
    if (metadata.downloadsLastWeek < LOW_DOWNLOADS) {
      score += 1;
      signals.push(`low weekly downloads (${metadata.downloadsLastWeek} < ${LOW_DOWNLOADS})`);
    }
  }

  if (typosquatHit) {
    score += 2;
    signals.push('name resembles a well-known package (possible typosquat)');
  }

  if (undeclared) {
    score += 1;
    signals.push('imported in source but not declared in any manifest');
  }

  const level = score >= 3 ? 'HIGH RISK' : score > 0 ? 'elevated' : 'ok';
  return { score, signals, level };
}
