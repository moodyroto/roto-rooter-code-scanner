import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResult } from '../src/score.js';

test('clean codebase scores 100 / A', () => {
  const r = scoreResult({ complexity: { flagged: [] }, security: { findings: [] } });
  assert.equal(r.value, 100);
  assert.equal(r.grade, 'A');
});

test('penalizes security findings and complexity', () => {
  const r = scoreResult({
    complexity: { flagged: [{ band: 'high-risk' }, { band: 'refactor' }] },
    security: { findings: [{ severity: 'high' }, { severity: 'medium' }] },
  });
  // 100 - (8 + 3) - (15 + 9) = 65
  assert.equal(r.value, 65);
  assert.equal(r.grade, 'D');
  assert.ok(r.breakdown.security < 0);
  assert.ok(!('secrets' in r.breakdown));
});

test('penalizes circular dependencies, capped at -24', () => {
  const base = { complexity: { flagged: [] }, security: { findings: [] } };
  const one = scoreResult({ ...base, dependencies: { cycles: [{ files: ['a', 'b'] }] } });
  assert.equal(one.breakdown.dependencies, -8);
  assert.equal(one.value, 92);
  const many = scoreResult({ ...base, dependencies: { cycles: [{}, {}, {}, {}] } });
  assert.equal(many.breakdown.dependencies, -24);
});

test('score works without a dependencies argument (defaults to no cycles)', () => {
  const r = scoreResult({ complexity: { flagged: [] }, security: { findings: [] } });
  assert.equal(r.value, 100);
  assert.equal(r.breakdown.dependencies, 0);
});
