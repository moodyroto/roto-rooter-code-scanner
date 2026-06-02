import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/scanner.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'function f(a){ if(a){return 1;} return 2; }\n// c\n');
  fs.writeFileSync(path.join(dir, 'broken.ts'), 'function (\n');
  fs.writeFileSync(path.join(dir, 'readme.md'), '# hi\n');
  return dir;
}

test('produces a complete result object', () => {
  const dir = fixture();
  const r = scan(dir, { threshold: 10 });
  assert.equal(r.summary.totalFiles, 3);
  assert.ok(r.summary.functions >= 1);
  assert.equal(r.summary.byLanguage.JavaScript >= 1, true);
  assert.ok('value' in r.score);
  assert.ok(Array.isArray(r.complexity.flagged));
  assert.ok(r.skipped.some((s) => s.file.endsWith('broken.ts')));
});

test('scanner skips gitignored files by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-gi-'));
  fs.mkdirSync(path.join(dir, 'generated'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'generated', 'x.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'generated/\n');

  const on = scan(dir);
  assert.equal(on.summary.byLanguage.JavaScript, 1); // only a.js

  const off = scan(dir, { gitignore: false });
  assert.equal(off.summary.byLanguage.JavaScript, 2); // a.js + generated/x.js
});

test('scanner skips test files by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'a.test.js'), 'const t = 1;\n');

  const def = scan(dir);
  assert.equal(def.summary.byLanguage.JavaScript, 1); // only a.js

  const all = scan(dir, { includeTests: true });
  assert.equal(all.summary.byLanguage.JavaScript, 2); // a.js + a.test.js
});
