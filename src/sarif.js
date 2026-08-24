// Build a SARIF 2.1.0 document from scan results and typosquat warnings.
//
// SARIF is the format GitHub code scanning and other tools consume, so emitting
// it lets `slopguard scan --format sarif` drop straight into a scanning workflow.
// No third-party dependencies.

// A package missing from its registry, or a name that looks like a typo of a
// famous package, becomes a `result`. We declare the two rules up front so the
// `ruleId` references are valid.

const NOT_FOUND_RULE = 'slopguard/not-found-in-registry';
const TYPOSQUAT_RULE = 'slopguard/possible-typosquat';

const RULES = [
  {
    id: NOT_FOUND_RULE,
    name: 'Package not found in registry',
    shortDescription: { text: 'A declared dependency is missing from its package registry.' },
    fullDescription: {
      text:
        'The package could not be found in the npm, PyPI, or RubyGems registry, so it may have been ' +
        'hallucinated by AI-generated code or be a typosquat.',
    },
    defaultConfiguration: { level: 'error' },
    helpUri: 'https://github.com/DUTJR5/slopguard',
  },
  {
    id: TYPOSQUAT_RULE,
    name: 'Possible typosquat',
    shortDescription: { text: 'A package name is similar to a well-known package.' },
    fullDescription: {
      text:
        'The package name is a small edit-distance away from a popular package, which is a common ' +
        'typosquatting pattern.',
    },
    defaultConfiguration: { level: 'warning' },
    helpUri: 'https://github.com/DUTJR5/slopguard',
  },
];

/**
 * @param {Array<{name: string, ecosystem: string, exists: boolean|null}>} results
 * @param {Array<{name: string, ecosystem: string, similarTo: string, distance: number}>} warnings
 */
export function toSarif(results, warnings) {
  const sarifResults = [];

  for (const r of results || []) {
    if (r.exists !== false) continue;
    sarifResults.push({
      ruleId: NOT_FOUND_RULE,
      level: 'error',
      message: {
        text: `Package "${r.name}" (${r.ecosystem}) was not found in its registry; it may be a hallucinated or typosquatted dependency.`,
      },
    });
  }

  for (const w of warnings || []) {
    sarifResults.push({
      ruleId: TYPOSQUAT_RULE,
      level: 'warning',
      message: {
        text: `Package "${w.name}" (${w.ecosystem}) looks like a typo of the well-known package "${w.similarTo}" (edit distance ${w.distance}).`,
      },
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'slopguard',
            informationUri: 'https://github.com/DUTJR5/slopguard',
            version: '0.1.0',
            rules: RULES,
          },
        },
        results: sarifResults,
      },
    ],
  };
}
