// Scan source files for imported package names.
//
// This is how we catch packages an AI "invented": it wrote an import statement
// for a package that does not exist and never listed it in a manifest. We pull
// every import out of JS/TS/Python sources and let the caller compare the names
// against what the manifests actually declare.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './manifests.js';

const SOURCE_RE = /\.(js|jsx|ts|tsx|py)$/;

// Matches:
//   import x from 'pkg'
//   import { a, b } from 'pkg'
//   import 'pkg'
//   import('pkg')
//   require('pkg') / require?.('pkg')
//   export ... from 'pkg'   (re-export still pulls in the module)
const JS_SPEC_RE =
  /(?:import\s+(?:[^'";]*?\s+from\s+)?|import\s*\(\s*|require\s*(?:\?\.)?\s*\(|export\s+[^'";]*?\s+from\s+)['"]([^'"]+)['"]/g;

// Python (line-based, see extractPyImports):
//   import a.b.c
//   import a, b, c
//   from a.b import name
const PY_IMPORT_RE = /^\s*(?:import\s+([\w.,\s]+)|from\s+([\w.]+)\s+import\b)/m;

let _stdlib = null;
async function stdlib() {
  if (!_stdlib) {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'py-stdlib.json');
    _stdlib = new Set(JSON.parse(await readFile(p, 'utf8')));
  }
  return _stdlib;
}

// Turn a JS/TS import specifier into its package name.
//   'pkg'            -> 'pkg'
//   'pkg/sub'        -> 'pkg'
//   '@scope/pkg'     -> '@scope/pkg'
//   '@scope/pkg/sub' -> '@scope/pkg'
// Relative paths (./ ../) and node: builtins are skipped by the caller.
function jsPackageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Drop block and line comments so example imports inside documentation are not
// mistaken for real ones. This is intentionally simple; it can mis-handle a `//`
// that appears inside a string literal, but that does not affect import lines.
function stripJsComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function extractJsImports(content) {
  const names = new Set();
  let m;
  while ((m = JS_SPEC_RE.exec(stripJsComments(content))) !== null) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    if (!spec) continue;
    names.add(jsPackageName(spec));
  }
  return names;
}

function pyTopModule(mod) {
  return mod.split('.')[0];
}

// Python is parsed line by line so that one `import` clause cannot swallow the
// rest of the file (whitespace/newlines and the `from` keyword would otherwise
// be absorbed by a greedy character class).
function extractPyImports(content, stdlibSet) {
  const names = new Set();
  for (const raw of content.split('\n')) {
    // Drop a trailing comment, then check for an import statement.
    const hash = raw.indexOf('#');
    const code = hash === -1 ? raw.trim() : raw.slice(0, hash).trim();
    if (!code) continue;

    const m = PY_IMPORT_RE.exec(code);
    if (!m) continue;

    if (m[1] !== undefined) {
      // `import a, b.c, d` -> consider each name separately
      for (const part of m[1].split(',')) {
        const mod = part.trim();
        if (!mod || mod.startsWith('.')) continue;
        const top = pyTopModule(mod);
        if (top && !stdlibSet.has(top)) names.add(top);
      }
    } else if (m[2] !== undefined) {
      if (m[2].startsWith('.')) continue; // relative import
      const top = pyTopModule(m[2]);
      if (top && !stdlibSet.has(top)) names.add(top);
    }
  }
  return names;
}

/**
 * Walk `root` and collect every package name imported by source files.
 *
 * @param {string} root
 * @returns {Promise<{imports: Array<{name: string, ecosystem: 'npm'|'pypi', file: string}>, files: string[]}>}
 */
export async function collectImports(root) {
  const files = (await walk(root)).filter((f) => SOURCE_RE.test(f));
  const stdlibSet = await stdlib();
  const imports = [];

  for (const file of files) {
    const ext = path.extname(file).slice(1);
    const isPy = ext === 'py';
    const content = await readFile(file, 'utf8');
    const found = isPy ? extractPyImports(content, stdlibSet) : extractJsImports(content);
    const ecosystem = isPy ? 'pypi' : 'npm';
    for (const name of found) {
      imports.push({ name, ecosystem, file });
    }
  }

  return { imports, files };
}
