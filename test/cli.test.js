import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, main } from '../src/cli.js';

test('parseArgs reads directory, formats, threshold', () => {
  const a = parseArgs(['/some/dir', '--format', 'json,md', '--threshold', '7', '--out', 'rep']);
  assert.equal(a.directory, '/some/dir');
  assert.deepEqual(a.formats, ['json', 'md']);
  assert.equal(a.threshold, 7);
  assert.equal(a.out, 'rep');
});

test('main scans a dir and writes reports, returns 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'function f(){ return 1; }\n');
  const out = path.join(dir, 'report');
  const code = await main([dir, '--out', out, '--format', 'json,md,html']);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(out, 'report.json')));
  assert.ok(fs.existsSync(path.join(out, 'report.md')));
  assert.ok(fs.existsSync(path.join(out, 'report.html')));
});

test('main returns 1 for a missing directory', async () => {
  const code = await main(['/no/such/dir/here']);
  assert.equal(code, 1);
});
