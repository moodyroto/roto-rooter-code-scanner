import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResult } from '../src/score.js';

test('clean codebase scores 100 / A', () => {
  const r = scoreResult({ complexity: { flagged: [] }, secrets: { findings: [] } });
  assert.equal(r.value, 100);
  assert.equal(r.grade, 'A');
});

test('penalizes secrets and complexity', () => {
  const r = scoreResult({
    complexity: { flagged: [{ band: 'high-risk' }, { band: 'refactor' }] },
    secrets: { findings: [{ severity: 'high' }, { severity: 'medium' }] },
  });
  // 100 - (8 + 3) - (15 + 9) = 100 - 11 - 24 = 65
  assert.equal(r.value, 65);
  assert.equal(r.grade, 'D');
  assert.ok(r.breakdown.secrets < 0);
  assert.ok(!('duplication' in r.breakdown));
});
