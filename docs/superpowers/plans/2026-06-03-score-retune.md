# Scoring Re-tune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-tune `scoreResult` to use per-category budgets (Security 40 / Complexity 20 / Dependencies 15 / Coverage 25, summing to 100) with each category capped, so no single category floors the score.

**Architecture:** Pure change to `src/score.js`; `breakdown` keys are unchanged so scanner/reporters are untouched. TDD via `test/score.test.js`.

**Tech Stack:** Node v24, ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-03-score-retune-design.md`

---

## Task 1: Apply per-category budgets to scoring

**Files:**
- Modify: `src/score.js` (replace whole file)
- Test: `test/score.test.js` (replace whole file)

- [ ] **Step 1: Replace `test/score.test.js` entirely with:**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/score.test.js`
Expected: FAIL — old model leaves security/complexity uncapped (cap tests fail), the dependency cap is −24 not −15, and coverage uses a 20-point budget (−12 not −15).

- [ ] **Step 3: Replace `src/score.js` entirely with:**

```javascript
const SEVERITY_MULT = { high: 1.0, medium: 0.6, low: 0.3 };
const BUDGET = { security: 40, complexity: 20, dependencies: 15, coverage: 25 };

function gradeFor(value) {
  if (value >= 90) return 'A';
  if (value >= 80) return 'B';
  if (value >= 70) return 'C';
  if (value >= 60) return 'D';
  return 'F';
}

export function scoreResult({ complexity, security, dependencies = { cycles: [] }, coverage = { ratio: 1 } }) {
  const securityRaw = security.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0);
  const complexityRaw = complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0);
  const dependenciesRaw = 8 * dependencies.cycles.length;
  const coverageRaw = Math.round(25 * (1 - coverage.ratio));

  const breakdown = {
    security: Number((-Math.min(BUDGET.security, securityRaw)).toFixed(2)),
    complexity: Number((-Math.min(BUDGET.complexity, complexityRaw)).toFixed(2)),
    dependencies: Number((-Math.min(BUDGET.dependencies, dependenciesRaw)).toFixed(2)),
    coverage: Number((-Math.min(BUDGET.coverage, coverageRaw)).toFixed(2)),
  };
  const raw = 100 + breakdown.security + breakdown.complexity + breakdown.dependencies + breakdown.coverage;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/score.test.js`
Expected: PASS (7 tests). Then `node --test` — ALL PASS (no other test asserts exact score values: the scanner test checks `'value' in r.score`; reporter tests use fixed fixtures).

- [ ] **Step 5: Commit**

```bash
git add src/score.js test/score.test.js
git commit -m "feat: per-category budget caps for the quality score"
```

---

## Task 2: Full suite + self-scan sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: ALL PASS.

- [ ] **Step 2: Self-scan shows a bounded breakdown**

```bash
node src/cli.js src --out scan-report --format json >/dev/null 2>&1
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('scan-report/report.json','utf8')); const b=j.score.breakdown; console.log('score', j.score.value, j.score.grade); console.log('breakdown', JSON.stringify(b)); console.log('each within budget:', b.security>=-40 && b.complexity>=-20 && b.dependencies>=-15 && b.coverage>=-25)"
rm -rf scan-report
```
Expected: a score/grade prints; `breakdown` shows the four negative category values; "each within budget: true". (For this repo: security 0, deps 0, coverage at its −25 cap since tests live in `test/`, complexity bounded at ≥ −20.)

- [ ] **Step 3: No commit (verification only)**

```bash
git status --short
```

---

## Self-Review Notes

- **Spec coverage:** budgets + caps (T1 code), all worked examples become tests (clean/A, 65/D, security −40 cap, complexity −20 cap, deps −15 cap, coverage −15 at 0.4, all-maxed 0/F), full-suite + self-scan bound check (T2).
- **Type consistency:** `breakdown` keeps the same four keys (`security`, `complexity`, `dependencies`, `coverage`) as negative numbers — unchanged contract for scanner/reporters.
- **No other files:** scanner passes `{ complexity, security, dependencies, coverage }` already; reporters read the same breakdown keys; nothing else changes.
- **Rounding:** `toFixed(2)` keeps fractional severity sums tidy; `value` is rounded and clamped.
