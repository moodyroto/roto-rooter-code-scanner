import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineMetrics } from '../src/metrics/lines.js';

test('splits total/code/comments/blanks', () => {
  const content = 'const a = 1;\n\n// note\nconst b = 2;\n';
  const m = lineMetrics(content, new Set([3])); // line 3 is a comment
  assert.equal(m.total, 4);
  assert.equal(m.blanks, 1);
  assert.equal(m.comments, 1);
  assert.equal(m.code, 2);
});

test('no comment set means all non-blank lines are code', () => {
  const m = lineMetrics('a\n\nb\n');
  assert.equal(m.code, 2);
  assert.equal(m.comments, 0);
});
