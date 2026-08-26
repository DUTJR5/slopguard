import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtmlReport } from '../src/report-html.js';

const STAMP = new Date('2026-08-27T10:00:00Z');

test('toHtmlReport returns a self-contained HTML document with no external dependencies', () => {
  const html = toHtmlReport({
    results: [{ name: 'react', ecosystem: 'npm' }],
    missing: [],
    warnings: [],
    undeclared: [],
    risky: [],
    generatedAt: STAMP,
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<style[\s\S]*<\/style>/);
  // No external resources: no <link>, no <script>, no @import, no external src.
  assert.doesNotMatch(html, /<link\b/);
  assert.doesNotMatch(html, /<script\b/);
  assert.doesNotMatch(html, /@import/);
  assert.doesNotMatch(html, /src=["']https?:/);
});

test('toHtmlReport marks NOT FOUND red and WARNING yellow', () => {
  const html = toHtmlReport({
    results: [],
    missing: [{ name: 'left-padz', ecosystem: 'npm' }],
    warnings: [{ name: 'reactt', ecosystem: 'npm', similarTo: 'react', distance: 1 }],
    undeclared: [],
    risky: [],
    generatedAt: STAMP,
  });
  // NOT FOUND badge exists and uses the red colour.
  assert.match(html, /NOT FOUND/);
  assert.match(html, /#c0392b/);
  // WARNING badge exists and uses the yellow colour.
  assert.match(html, /WARNING/);
  assert.match(html, /#fff7cc/);
});

test('toHtmlReport lists every finding in the detail table', () => {
  const html = toHtmlReport({
    results: [],
    missing: [{ name: 'novrpkg', ecosystem: 'npm' }],
    warnings: [{ name: 'flaskk', ecosystem: 'pypi', similarTo: 'flask', distance: 1 }],
    undeclared: [{ name: 'lodahs', ecosystem: 'npm', file: 'app.js' }],
    risky: [{ name: 'newpkg', ecosystem: 'npm', score: 4, level: 'HIGH RISK', signals: ['age < 30d', 'typosquat'] }],
    generatedAt: STAMP,
  });
  for (const name of ['novrpkg', 'flaskk', 'lodahs', 'newpkg']) {
    assert.match(html, new RegExp(name));
  }
  // Each finding kind appears as a badge.
  assert.match(html, /NOT FOUND/);
  assert.match(html, /WARNING/);
  assert.match(html, /UNDECLARED/);
  assert.match(html, /RISK/);
});

test('toHtmlReport summary counts match the input', () => {
  const html = toHtmlReport({
    results: [{}, {}, {}], // 3 packages checked
    missing: [{ name: 'a', ecosystem: 'npm' }], // 1 NOT FOUND
    warnings: [
      { name: 'b', ecosystem: 'npm', similarTo: 'x', distance: 1 },
      { name: 'c', ecosystem: 'npm', similarTo: 'y', distance: 2 },
    ], // 2 WARNING
    undeclared: [],
    risky: [],
    generatedAt: STAMP,
  });
  assert.match(html, /card-value">3<\/div>\s*<div class="card-label">Packages checked/);
  assert.match(html, /card-value">1<\/div>\s*<div class="card-label">NOT FOUND/);
  assert.match(html, /card-value">2<\/div>\s*<div class="card-label">WARNING \(typosquat\)/);
  assert.match(html, /card-value">3<\/div>\s*<div class="card-label">Total issues/);
});

test('toHtmlReport shows a clean result when there are no findings', () => {
  const html = toHtmlReport({
    results: [{}, {}],
    missing: [],
    warnings: [],
    undeclared: [],
    risky: [],
    generatedAt: STAMP,
  });
  assert.match(html, /No issues found/);
  // No finding rows -> no severity badges should be rendered.
  assert.doesNotMatch(html, /class="badge"/);
});

test('toHtmlReport escapes package names so HTML cannot break out', () => {
  const html = toHtmlReport({
    results: [],
    missing: [{ name: '<img src=x onerror=alert(1)>', ecosystem: 'npm' }],
    warnings: [],
    undeclared: [],
    risky: [],
    generatedAt: STAMP,
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});
