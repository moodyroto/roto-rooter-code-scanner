import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResult } from '../src/score.js';

test('clean codebase scores 100 / A', () => {
  const r = scoreResult({ complexity: { flagged: [] }, duplication: { percentage: 0 }, secrets: { findings: [] } });
  assert.equal(r.value, 100);
  assert.equal(r.grade, 'A');
});

test('penalizes secrets, complexity and duplication and clamps at 0', () => {
  const r = scoreResult({
    complexity: { flagged: [{ band: 'high-risk' }, { band: 'refactor' }] },
    duplication: { percentage: 20 },
    secrets: { findings: [{ severity: 'high' }, { severity: 'medium' }] },
  });
  // 100 - (8+3) - min(10,25) - (15 + 9) = 100 - 11 - 10 - 24 = 55
  assert.equal(r.value, 55);
  assert.equal(r.grade, 'F');
  assert.ok(r.breakdown.secrets < 0);
});
