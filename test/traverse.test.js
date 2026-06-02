import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { traverse } from '../src/traverse.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trav-'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1');
  fs.writeFileSync(path.join(dir, 'node_modules', 'b.js'), '1');
  fs.writeFileSync(path.join(dir, 'readme.md'), '1');
  return dir;
}

test('walks recursively and skips default ignores', () => {
  const dir = fixture();
  const files = traverse(dir, {}).map((f) => path.relative(dir, f));
  assert.ok(files.includes(path.join('src', 'a.js')));
  assert.ok(files.includes('readme.md'));
  assert.ok(!files.some((f) => f.includes('node_modules')));
});

test('returns absolute paths even when given a relative root', () => {
  const dir = fixture();
  const rel = path.relative(process.cwd(), dir);
  const files = traverse(rel, {});
  assert.ok(files.every((f) => path.isAbsolute(f)));
});

test('respects root .gitignore by default and can be disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trav-gi-'));
  fs.mkdirSync(path.join(dir, 'generated'));
  fs.writeFileSync(path.join(dir, 'a.js'), '1');
  fs.writeFileSync(path.join(dir, 'generated', 'x.js'), '1');
  fs.writeFileSync(path.join(dir, 'debug.log'), '1');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'generated/\n*.log\n');

  const on = traverse(dir, {}).map((f) => path.relative(dir, f));
  assert.ok(on.includes('a.js'));
  assert.ok(!on.some((f) => f.startsWith('generated')));
  assert.ok(!on.includes('debug.log'));

  const off = traverse(dir, { gitignore: false }).map((f) => path.relative(dir, f));
  assert.ok(off.includes(path.join('generated', 'x.js')));
});
