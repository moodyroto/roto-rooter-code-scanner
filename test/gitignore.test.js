import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGitignore, isIgnored } from '../src/gitignore.js';

function tmp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-'));
  if (contents !== null) fs.writeFileSync(path.join(dir, '.gitignore'), contents);
  return dir;
}

test('loadGitignore returns null when no .gitignore exists', () => {
  assert.equal(loadGitignore(tmp(null)), null);
});

test('isIgnored honors patterns and negation', () => {
  const m = loadGitignore(tmp('generated/\n*.log\n!keep.log\n'));
  assert.equal(isIgnored(m, 'generated/x.js'), true);
  assert.equal(isIgnored(m, 'debug.log'), true);
  assert.equal(isIgnored(m, 'keep.log'), false);
  assert.equal(isIgnored(m, 'a.js'), false);
});

test('isIgnored returns false for a null matcher and for the root', () => {
  assert.equal(isIgnored(null, 'anything.js'), false);
  const m = loadGitignore(tmp('*.log\n'));
  assert.equal(isIgnored(m, ''), false);
  assert.equal(isIgnored(m, '.'), false);
});
