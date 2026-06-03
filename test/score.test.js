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

test('penalizes low test coverage', () => {
  const base = { complexity: { flagged: [] }, security: { findings: [] }, dependencies: { cycles: [] } };
  const low = scoreResult({ ...base, coverage: { ratio: 0.4 } });
  assert.equal(low.breakdown.coverage, -12); // -round(20 * 0.6)
  const full = scoreResult({ ...base, coverage: { ratio: 1 } });
  assert.equal(full.breakdown.coverage, 0);
});

test('score defaults coverage to fully-covered when omitted', () => {
  const r = scoreResult({ complexity: { flagged: [] }, security: { findings: [] } });
  assert.equal(r.breakdown.coverage, 0);
  assert.equal(r.value, 100);
});
