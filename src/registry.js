// Check whether packages exist in their registry, with bounded concurrency
// and per-request timeouts. No third-party dependencies.

const CONCURRENCY = 8;
const TIMEOUT_MS = 8000;

async function fetchStatus(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'slopguard (https://github.com/DUTJR5/slopguard)' },
    });
    // Drain the body so the connection can be reused.
    await res.arrayBuffer().catch(() => {});
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null; // rate limited, server error, etc.
  } catch {
    return null; // network failure or timeout
  }
}

export function registryUrl(name, ecosystem) {
  if (ecosystem === 'npm') {
    // Scoped packages: @scope/name -> @scope%2fname
    return `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
  }
  if (ecosystem === 'pypi') {
    return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  }
  if (ecosystem === 'rubygems') {
    return `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`;
  }
  throw new Error(`unsupported ecosystem: ${ecosystem}`);
}

export async function checkPackage(name, ecosystem) {
  const exists = await fetchStatus(registryUrl(name, ecosystem));
  return {
    name,
    ecosystem,
    exists,
    ...(exists === null ? { reason: 'registry unreachable or returned an unexpected status' } : {}),
  };
}

/**
 * Check many packages with a small worker pool.
 * @param {Array<{name: string, ecosystem: string}>} packages
 * @returns {Promise<Array<{name: string, ecosystem: string, exists: boolean|null, reason?: string}>>}
 */
export async function checkPackages(packages) {
  const results = new Array(packages.length);
  let next = 0;

  async function worker() {
    while (next < packages.length) {
      const i = next++;
      results[i] = await checkPackage(packages[i].name, packages[i].ecosystem);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, packages.length) }, worker));
  return results;
}
