import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registryUrl } from '../src/registry.js';

test('npm url keeps scoped package separator as %2f', () => {
  assert.equal(registryUrl('left-pad', 'npm', 'https://registry.npmjs.org'), 'https://registry.npmjs.org/left-pad');
  assert.equal(registryUrl('@scope/name', 'npm', 'https://npm.mycompany.com'), 'https://npm.mycompany.com/@scope%2fname');
});

test('pypi url uses JSON API by default', () => {
  assert.equal(registryUrl('requests', 'pypi', 'https://pypi.org'), 'https://pypi.org/pypi/requests/json');
  assert.equal(registryUrl('Django', 'pypi', 'https://pypi.org'), 'https://pypi.org/pypi/Django/json');
});

test('pypi url degrades to simple index GET when base ends with /simple', () => {
  // A private PyPI simple index (PEP 503) has no JSON API, so we just probe the
  // page and treat 200 as "exists", 404 as "missing".
  assert.equal(
    registryUrl('requests', 'pypi', 'https://pypi.mycompany.com/simple'),
    'https://pypi.mycompany.com/simple/requests/',
  );
});

test('rubygems url uses the v1 gems JSON endpoint', () => {
  assert.equal(registryUrl('rails', 'rubygems', 'https://rubygems.org'), 'https://rubygems.org/api/v1/gems/rails.json');
});
