// Build a self-contained HTML report from a scan result set.
//
// `slopguard scan --format html` writes this to <scanned-dir>/slopguard-report.html.
// The file inlines its own CSS and ships no external fonts, stylesheets or scripts,
// so it opens offline in any browser. NOT FOUND findings are marked red and
// typosquat WARNING findings are marked yellow.

// Each finding kind maps to a badge colour. The first two are the ones the
// project-wide rule calls out by name (red = NOT FOUND, yellow = WARNING).
const BADGE = {
  notfound: { label: 'NOT FOUND', color: '#c0392b', bg: '#fdecea' },
  warning: { label: 'WARNING', color: '#8a6d00', bg: '#fff7cc' },
  undeclared: { label: 'UNDECLARED', color: '#a04000', bg: '#fdf0e3' },
  risk: { label: 'RISK', color: '#6c3483', bg: '#f3eaf8' },
};

// Lower rank = shown first in the detail table.
const SEVERITY_RANK = {
  notfound: 0,
  warning: 1,
  undeclared: 2,
  risk: 3,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} input
 * @param {string} [input.root]
 * @param {string[]} [input.manifests]
 * @param {string[]} [input.lockfiles]
 * @param {Array<{name: string, ecosystem: string}>} [input.results]
 * @param {Array<{name: string, ecosystem: string}>} [input.missing]
 * @param {Array<{name: string, ecosystem: string}>} [input.uncertain]
 * @param {Array<{name: string, ecosystem: string, similarTo: string, distance: number}>} [input.warnings]
 * @param {Array<{name: string, ecosystem: string, file: string}>} [input.undeclared]
 * @param {Array<{name: string, ecosystem: string, score: number, level: string, signals: string[]}>} [input.risky]
 * @param {{enabled: boolean, hits: number, fetches: number}} [input.cache]
 * @param {Date|string} [input.generatedAt]
 * @returns {string} a complete HTML document
 */
export function toHtmlReport(input = {}) {
  const {
    root = '',
    manifests = [],
    lockfiles = [],
    results = [],
    missing = [],
    uncertain = [],
    warnings = [],
    undeclared = [],
    risky = [],
    cache = { enabled: false, hits: 0, fetches: 0 },
    generatedAt = new Date(),
  } = input;

  // Collect every finding into one list, then sort by severity.
  const rows = [];
  for (const r of missing) {
    rows.push({
      severity: 'notfound',
      ecosystem: r.ecosystem,
      name: r.name,
      detail: 'Not found in its registry. Possible hallucinated or typosquatted package.',
    });
  }
  for (const w of warnings) {
    rows.push({
      severity: 'warning',
      ecosystem: w.ecosystem,
      name: w.name,
      detail: `Name is similar to the well-known package "${w.similarTo}" (edit distance ${w.distance}). Possible typosquat.`,
    });
  }
  for (const imp of undeclared) {
    rows.push({
      severity: 'undeclared',
      ecosystem: imp.ecosystem,
      name: imp.name,
      detail: `Imported in ${imp.file} but not declared in any manifest.`,
    });
  }
  for (const rk of risky) {
    rows.push({
      severity: 'risk',
      ecosystem: rk.ecosystem,
      name: rk.name,
      detail: `Risk score ${rk.score} (${rk.level}). Signals: ${rk.signals.join('; ')}.`,
    });
  }
  rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const totalIssues = rows.length;
  const generated = generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt);
  const generatedDisplay = `${generated.slice(0, 10)} ${generated.slice(11, 19)} UTC`;

  const summaryCards = [
    { label: 'Packages checked', value: results.length },
    { label: 'NOT FOUND', value: missing.length },
    { label: 'WARNING (typosquat)', value: warnings.length },
    { label: 'UNDECLARED imports', value: undeclared.length },
    { label: 'RISK flagged', value: risky.length },
    { label: 'Total issues', value: totalIssues },
  ];

  const cardsHtml = summaryCards
    .map(
      (c) =>
        `<div class="card"><div class="card-value">${c.value}</div><div class="card-label">${escapeHtml(
          c.label,
        )}</div></div>`,
    )
    .join('\n');

  const rowsHtml = rows.length
    ? rows
        .map((r) => {
          const b = BADGE[r.severity];
          return `<tr>
      <td><span class="badge" style="color:${b.color};background:${b.bg}">${b.label}</span></td>
      <td>${escapeHtml(r.ecosystem)}</td>
      <td><code>${escapeHtml(r.name)}</code></td>
      <td>${escapeHtml(r.detail)}</td>
    </tr>`;
        })
        .join('\n')
    : `<tr><td colspan="4" class="clean">No issues found. Every checked package exists in its registry and no typosquats or undeclared imports were detected.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>slopguard report</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 2rem; background: #fafafa; color: #222; }
  h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
  .sub { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .cards { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.75rem; }
  .card { background: #fff; border: 1px solid #e2e2e2; border-radius: 8px; padding: 0.9rem 1.1rem; min-width: 120px; flex: 1; }
  .card-value { font-size: 1.6rem; font-weight: 700; }
  .card-label { font-size: 0.78rem; color: #666; margin-top: 0.2rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e2e2; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid #eee; font-size: 0.9rem; vertical-align: top; }
  th { background: #f3f3f3; font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  code { background: #f3f3f3; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.85rem; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em; }
  .clean { text-align: center; color: #2e7d32; font-weight: 600; padding: 1.5rem; }
  .meta { margin-top: 1.5rem; color: #888; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>slopguard report</h1>
<div class="sub">Dependency hallucination &amp; typosquat scan${root ? ` &mdash; ${escapeHtml(root)}` : ''}</div>
<div class="cards">
${cardsHtml}
</div>
<table>
  <thead>
    <tr><th>Severity</th><th>Ecosystem</th><th>Package</th><th>Detail</th></tr>
  </thead>
  <tbody>
${rowsHtml}
  </tbody>
</table>
<div class="meta">
  Generated ${escapeHtml(generatedDisplay)}.
  Scanned ${manifests.length} manifest(s), ${lockfiles.length} lockfile(s).
  Cache ${cache.enabled ? `enabled (${cache.hits} hit(s), ${cache.fetches} fetch(es))` : 'disabled'}.
  ${uncertain.length ? `${uncertain.length} package(s) could not be verified (offline or network error).` : ''}
</div>
</body>
</html>
`;
}
