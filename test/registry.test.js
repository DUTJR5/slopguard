import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registryUrl, goModuleEscape, checkPackage } from '../src/registry.js';
import { createCache } from '../src/cache.js';

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

test('go url escapes uppercase module path letters with ! and lowercases', () => {
  assert.equal(
    registryUrl('github.com/Shopify/go-que', 'go', 'https://proxy.golang.org'),
    'https://proxy.golang.org/github.com/!shopify/go-que/@v/list',
  );
  assert.equal(
    registryUrl('github.com/gin-gonic/gin', 'go', 'https://proxy.golang.org'),
    'https://proxy.golang.org/github.com/gin-gonic/gin/@v/list',
  );
});

test('goModuleEscape only touches uppercase letters', () => {
  assert.equal(goModuleEscape('github.com/Shopify/go-que'), 'github.com/!shopify/go-que');
  assert.equal(goModuleEscape('a/B/c/D'), 'a/!b/c/!d');
});

test('rust url targets the crates.io crate API', () => {
  assert.equal(
    registryUrl('serde', 'rust', 'https://crates.io'),
    'https://crates.io/api/v1/crates/serde',
  );
});

// The remaining tests stub global.fetch so they exercise the adapter parsing
// (metadata extraction, existence verdicts) without touching the network.

function stubFetch(handler) {
  const orig = global.fetch;
  global.fetch = handler;
  return () => {
    global.fetch = orig;
  };
}

function fakeRes(status, body) {
  return {
    status,
    async json() {
      return body;
    },
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
  };
}

test('checkPackage(npm) parses createdAt and weekly downloads into metadata', async () => {
  const restore = stubFetch(async (url) => {
    if (url.includes('api.npmjs.org/downloads')) {
      return fakeRes(200, { downloads: 42 });
    }
    return fakeRes(200, { time: { created: '2024-01-01T00:00:00.000Z' } });
  });
  try {
    const cfg = {};
    const r = await checkPackage('left-pad', 'npm', cfg);
    assert.equal(r.exists, true);
    assert.equal(typeof r.metadata.createdAt, 'number');
    assert.ok(r.metadata.createdAt > 0);
    assert.equal(r.metadata.downloadsLastWeek, 42);
  } finally {
    restore();
  }
});

test('checkPackage(pypi) finds earliest release upload_time as createdAt', async () => {
  const restore = stubFetch(async () => {
    return fakeRes(200, {
      releases: {
        '1.0.0': [{ upload_time: '2023-05-01T00:00:00Z' }],
        '2.0.0': [{ upload_time: '2024-06-01T00:00:00Z' }],
      },
    });
  });
  try {
    const r = await checkPackage('requests', 'pypi', {});
    assert.equal(r.exists, true);
    assert.ok(r.metadata.createdAt > 0);
    assert.equal(r.metadata.downloadsLastWeek, null);
  } finally {
    restore();
  }
});

test('checkPackage(go) treats 200 on /@v/list as exists with no createdAt', async () => {
  const restore = stubFetch(async () => fakeRes(200, 'v1.0.0\nv1.1.0\n'));
  try {
    const r = await checkPackage('github.com/gin-gonic/gin', 'go', {});
    assert.equal(r.exists, true);
    assert.equal(r.metadata.createdAt, null);
  } finally {
    restore();
  }
});

test('checkPackage(rust) parses crate.created_at from crates.io response', async () => {
  const restore = stubFetch(async () => fakeRes(200, { crate: { created_at: '2022-03-03T00:00:00.000Z' } }));
  try {
    const r = await checkPackage('serde', 'rust', {});
    assert.equal(r.exists, true);
    assert.ok(r.metadata.createdAt > 0);
  } finally {
    restore();
  }
});

test('checkPackage(404) reports exists:false and is cached for reuse', async () => {
  let calls = 0;
  const restore = stubFetch(async () => {
    calls++;
    return fakeRes(404, '');
  });
  try {
    const cache = createCache(process.cwd(), { enabled: true });
    const a = await checkPackage('nope-pkg', 'npm', {}, { cache });
    assert.equal(a.exists, false);
    const b = await checkPackage('nope-pkg', 'npm', {}, { cache });
    assert.equal(b.exists, false);
    assert.equal(calls, 1, 'second call should be served from cache, not refetched');
    await cache.save();
  } finally {
    restore();
  }
});

test('offline mode returns uncertain without calling fetch', async () => {
  let called = false;
  const restore = stubFetch(async () => {
    called = true;
    return fakeRes(200, {});
  });
  try {
    const r = await checkPackage('react', 'npm', {}, { offline: true });
    assert.equal(r.exists, null);
    assert.equal(called, false);
  } finally {
    restore();
  }
});
