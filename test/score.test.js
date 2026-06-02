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
