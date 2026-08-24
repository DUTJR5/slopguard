#!/usr/bin/env node
// Extract the changelog section for a given version from CHANGELOG.md and
// print it to stdout. Used by .github/workflows/release.yml to build the
// GitHub Release body. A leading "v" on the version argument is stripped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const version = process.argv[2] || '';
const target = version.replace(/^v/i, '').trim();

if (!target) {
  console.error('Usage: node extract-changelog.mjs <version>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const changelogPath = join(here, '..', 'CHANGELOG.md');
const text = readFileSync(changelogPath, 'utf8');

const lines = text.split('\n');
let collecting = false;
let found = false;
const buffer = [];

for (const line of lines) {
  const header = line.match(/^##\s+\[([^\]]+)\]/);
  if (header) {
    const section = header[1].trim();
    if (section.toLowerCase() === target.toLowerCase()) {
      collecting = true;
      found = true;
      continue;
    }
    if (collecting) break; // reached the next version section
  }
  if (collecting) buffer.push(line);
}

if (!found) {
  console.error(`No changelog section found for version "${target}"`);
  process.exit(1);
}

const body = buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim();
process.stdout.write(body + '\n');
