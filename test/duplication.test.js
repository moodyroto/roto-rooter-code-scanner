import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { findDuplication } from '../src/analyzers/duplication.js';

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

test('no duplication on unique files', () => {
  const a = parseFile('const a = 1;\nconst b = 2;\n', 'a.js');
  const res = findDuplication([{ file: 'a.js', content: 'const a = 1;\nconst b = 2;\n', tokens: a.tokens }]);
  assert.equal(res.percentage, 0);
  assert.equal(res.clusters.length, 0);
});
