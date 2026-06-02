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
