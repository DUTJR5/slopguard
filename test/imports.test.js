import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectImports } from '../src/imports.js';

async function makeDir() {
  return mkdtemp(path.join(tmpdir(), 'slopguard-imports-'));
}

// Distinct "ecosystem:name" pairs, sorted for stable comparisons.
function namesOf(result) {
  const set = new Set();
  for (const i of result.imports) set.add(`${i.ecosystem}:${i.name}`);
  return [...set].sort();
}

test('collectImports extracts JS/TS package names', async () => {
  const dir = await makeDir();
  try {
    await writeFile(
      path.join(dir, 'app.js'),
      [
        "import React from 'react';",
        "import { map } from 'lodash/map';",
        "import 'side-effect-pkg';",
        "const x = import('@scope/pkg/sub');",
        "const y = require('express');",
        "const z = require?.('chai');",
        "import type { T } from 'typescript';",
        "import './local-file';",
        "import fs from 'node:fs';",
        "import('/abs/path');",
      ].join('\n'),
    );
    const res = await collectImports(dir);
    assert.deepEqual(namesOf(res), [
      'npm:@scope/pkg',
      'npm:chai',
      'npm:express',
      'npm:lodash',
      'npm:react',
      'npm:side-effect-pkg',
      'npm:typescript',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectImports extracts Python imports and skips stdlib', async () => {
  const dir = await makeDir();
  try {
    await writeFile(
      path.join(dir, 'main.py'),
      [
        'import os',
        'import numpy',
        'from scipy import stats',
        'import sys, json',
        'from collections import OrderedDict',
        'import torch.nn',
        'from __future__ import annotations',
        'from . import foo',
        'from .rel import bar',
      ].join('\n'),
    );
    const res = await collectImports(dir);
    assert.deepEqual(namesOf(res), ['pypi:numpy', 'pypi:scipy', 'pypi:torch']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectImports skips node_modules and venv directories', async () => {
  const dir = await makeDir();
  try {
    await writeFile(path.join(dir, 'app.js'), "import 'real-pkg';");
    await mkdir(path.join(dir, 'node_modules'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules', 'app.js'), "import 'ghost-pkg';");
    await mkdir(path.join(dir, 'venv'), { recursive: true });
    await writeFile(path.join(dir, 'venv', 'app.py'), 'import numpy');
    const res = await collectImports(dir);
    assert.deepEqual(namesOf(res), ['npm:real-pkg']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('collectImports only scans source files', async () => {
  const dir = await makeDir();
  try {
    await writeFile(path.join(dir, 'app.js'), "import 'kept-pkg';");
    await writeFile(path.join(dir, 'readme.md'), "import 'md-fake-pkg';");
    await writeFile(path.join(dir, 'notes.txt'), "import 'txt-fake-pkg';");
    const res = await collectImports(dir);
    assert.deepEqual(namesOf(res), ['npm:kept-pkg']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
