import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJson } from '../src/report/json.js';

test('serializes result to pretty JSON', () => {
  const out = toJson({ score: { value: 90, grade: 'A' } });
  assert.equal(JSON.parse(out).score.grade, 'A');
  assert.ok(out.includes('\n')); // pretty printed
});
