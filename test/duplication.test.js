import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { findDuplication, normalizeLines } from '../src/analyzers/duplication.js';

const block = `function calc(a, b) {
  const x = a + b;
  const y = x * 2;
  const z = y - a;
  return z + b;
}`;

test('detects a duplicated block across two files and reports percentage', () => {
  const f1 = parseFile(block, 'a.js');
  const f2 = parseFile(block, 'b.js');
  const res = findDuplication([
    { file: 'a.js', content: block, tokens: f1.tokens },
    { file: 'b.js', content: block, tokens: f2.tokens },
  ], { minLines: 5 });
  assert.ok(res.percentage > 0);
  assert.equal(res.clusters.length >= 1, true);
  assert.equal(res.clusters[0].occurrences.length, 2);
});

test('detects near-duplicate blocks with renamed identifiers', () => {
  const a = `function alpha(one, two) {
  const sum = one + two;
  const dbl = sum * 2;
  const adj = dbl - one;
  return adj + two;
}`;
  const b = `function beta(x, y) {
  const total = x + y;
  const twice = total * 2;
  const fixed = twice - x;
  return fixed + y;
}`;
  const fa = parseFile(a, 'a.js');
  const fb = parseFile(b, 'b.js');
  const res = findDuplication([
    { file: 'a.js', content: a, tokens: fa.tokens },
    { file: 'b.js', content: b, tokens: fb.tokens },
  ], { minLines: 5 });
  assert.ok(res.clusters.length >= 1, 'expected at least one cluster');
  assert.equal(res.clusters[0].kind, 'near');
});

test('no duplication on unique files', () => {
  const a = parseFile('const a = 1;\nconst b = 2;\n', 'a.js');
  const res = findDuplication([{ file: 'a.js', content: 'const a = 1;\nconst b = 2;\n', tokens: a.tokens }]);
  assert.equal(res.percentage, 0);
  assert.equal(res.clusters.length, 0);
});

test('normalizeLines tolerates missing tokens', () => {
  assert.deepEqual(normalizeLines('const a = 1;\n', undefined), []);
});
