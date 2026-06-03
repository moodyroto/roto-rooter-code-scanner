import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResult } from '../src/score.js';

test('clean codebase scores 100 / A', () => {
  const r = scoreResult({ complexity: { flagged: [] }, security: { findings: [] } });
  assert.equal(r.value, 100);
  assert.equal(r.grade, 'A');
});

test('penalizes security and complexity under budget', () => {
  const r = scoreResult({
    complexity: { flagged: [{ band: 'high-risk' }, { band: 'refactor' }] }, // 8+3=11
    security: { findings: [{ severity: 'high' }, { severity: 'medium' }] },  // 15+9=24
  });
  assert.equal(r.value, 65); // 100 - 24 - 11
  assert.equal(r.grade, 'D');
  assert.equal(r.breakdown.security, -24);
  assert.equal(r.breakdown.complexity, -11);
});

test('caps security at -40 and complexity at -20', () => {
  const r = scoreResult({
    complexity: { flagged: Array(10).fill({ band: 'high-risk' }) }, // 80 -> cap 20
    security: { findings: Array(4).fill({ severity: 'high' }) },     // 60 -> cap 40
  });
  assert.equal(r.breakdown.security, -40);
  assert.equal(r.breakdown.complexity, -20);
});

test('caps circular-dependency penalty at -15', () => {
  const base = { complexity: { flagged: [] }, security: { findings: [] } };
  assert.equal(scoreResult({ ...base, dependencies: { cycles: [{}] } }).breakdown.dependencies, -8);
  assert.equal(scoreResult({ ...base, dependencies: { cycles: [{}, {}, {}, {}] } }).breakdown.dependencies, -15);
});

test('coverage penalty uses a 25-point budget', () => {
  const base = { complexity: { flagged: [] }, security: { findings: [] } };
  assert.equal(scoreResult({ ...base, coverage: { ratio: 0.4 } }).breakdown.coverage, -15); // round(25*0.6)
  assert.equal(scoreResult({ ...base, coverage: { ratio: 1 } }).breakdown.coverage, 0);
});

test('omitting dependencies/coverage yields 0 penalty for those categories', () => {
  const r = scoreResult({ complexity: { flagged: [] }, security: { findings: [] } });
  assert.equal(r.breakdown.dependencies, 0);
  assert.equal(r.breakdown.coverage, 0);
});

test('all categories maxed -> 0 / F', () => {
  const r = scoreResult({
    complexity: { flagged: Array(10).fill({ band: 'high-risk' }) },
    security: { findings: Array(5).fill({ severity: 'high' }) },
    dependencies: { cycles: [{}, {}, {}] },
    coverage: { ratio: 0 },
  });
  assert.equal(r.value, 0);
  assert.equal(r.grade, 'F');
});
