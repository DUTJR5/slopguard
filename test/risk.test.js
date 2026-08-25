import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRisk } from '../src/risk.js';

const DAY = 86400000;
const now = Date.now();
const young = now - 5 * DAY; // 5 days old
const old = now - 365 * DAY; // 1 year old

test('young package (< 30 days) earns +2 and reports the age signal', () => {
  const r = computeRisk({ name: 'fresh-pkg', ecosystem: 'npm', metadata: { createdAt: young, downloadsLastWeek: null } });
  assert.equal(r.score, 2);
  assert.ok(r.signals.some((s) => s.includes('day(s) ago')));
});

test('old package earns no age points', () => {
  const r = computeRisk({ name: 'mature-pkg', ecosystem: 'npm', metadata: { createdAt: old, downloadsLastWeek: null } });
  assert.equal(r.score, 0);
});

test('npm weekly downloads < 100 earns +1', () => {
  const r = computeRisk({ name: 'tiny-pkg', ecosystem: 'npm', metadata: { createdAt: old, downloadsLastWeek: 42 } });
  assert.equal(r.score, 1);
  assert.ok(r.signals.some((s) => s.includes('low weekly downloads')));
});

test('npm weekly downloads of exactly 100 earns nothing', () => {
  const r = computeRisk({ name: 'edge-pkg', ecosystem: 'npm', metadata: { createdAt: old, downloadsLastWeek: 100 } });
  assert.equal(r.score, 0);
});

test('PyPI download signal is always skipped (no public weekly API)', () => {
  // Even if a caller passed a number, PyPI is not npm so the signal is ignored.
  const r = computeRisk({ name: 'some-pkg', ecosystem: 'pypi', metadata: { createdAt: old, downloadsLastWeek: 5 } });
  assert.equal(r.score, 0);
});

test('typosquat hit earns +2', () => {
  const r = computeRisk({ name: 'reactt', ecosystem: 'npm', metadata: { createdAt: old }, typosquatHit: true });
  assert.equal(r.score, 2);
  assert.ok(r.signals.some((s) => s.includes('typosquat')));
});

test('imported-but-undeclared earns +1', () => {
  const r = computeRisk({ name: 'left-pad', ecosystem: 'npm', metadata: { createdAt: old }, undeclared: true });
  assert.equal(r.score, 1);
});

test('combined young + typosquat + undeclared => HIGH RISK (>=3)', () => {
  const r = computeRisk({
    name: 'newreactt',
    ecosystem: 'npm',
    metadata: { createdAt: young, downloadsLastWeek: 10 },
    typosquatHit: true,
    undeclared: true,
  });
  assert.equal(r.score, 2 + 2 + 1 + 1); // age + typosquat + download + undeclared
  assert.equal(r.level, 'HIGH RISK');
});

test('score of 1 or 2 is "elevated", not HIGH RISK', () => {
  const r = computeRisk({ name: 'x', ecosystem: 'npm', metadata: { createdAt: old }, undeclared: true });
  assert.equal(r.score, 1);
  assert.equal(r.level, 'elevated');
});

test('Go package with no createdAt only scores local signals', () => {
  // Go proxy exposes no publish date, so age is skipped; an undeclared import
  // still adds its point.
  const r = computeRisk({ name: 'example.com/x', ecosystem: 'go', metadata: { createdAt: null }, undeclared: true });
  assert.equal(r.score, 1);
});
