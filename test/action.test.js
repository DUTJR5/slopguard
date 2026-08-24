import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const actionYml = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');

test('action.yml exists and declares a composite action', () => {
  assert.ok(actionYml.includes('using: composite'), 'should declare using: composite');
  assert.ok(actionYml.includes('runs:'), 'should have a runs section');
});

test('action.yml defines the expected inputs', () => {
  assert.ok(actionYml.includes('path:'), 'should define a path input');
  assert.ok(actionYml.includes('fail-on-findings:'), 'should define a fail-on-findings input');
});

test('action.yml sets branding', () => {
  assert.ok(actionYml.includes('icon: shield'), 'should use the shield icon');
  assert.ok(actionYml.includes('color: blue'), 'should use the blue color');
});

test('action.yml posts PR comments via github-script', () => {
  assert.ok(actionYml.includes('actions/github-script@v7'), 'should use actions/github-script@v7');
  assert.ok(actionYml.includes("github.event_name == 'pull_request'"), 'PR comment step only runs on pull_request');
});
