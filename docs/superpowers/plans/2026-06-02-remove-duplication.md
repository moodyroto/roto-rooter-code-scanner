# P0 — Remove Duplication Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the code-duplication feature cleanly from the scanner, scoring, reporters, result shape, tests, and docs, leaving all tests green.

**Architecture:** Strip the `duplication` analyzer and every consumer. Order matters: update score, then reporters (stop referencing `duplication`), then scanner (stop producing it), then delete the analyzer/rule/docs — so no live-render path ever sees a missing key.

**Tech Stack:** Node v24, ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-02-remove-duplication-design.md`

---

## Resulting shapes (locked)

- Result object: `{ meta, summary, complexity, secrets, score, skipped }` (no `duplication`).
- Score: `{ value, grade, breakdown: { secrets, complexity } }`.
- `scoreResult({ complexity, secrets })`.

---

## Task 1: Drop duplication from scoring

**Files:**
- Modify: `src/score.js`
- Test: `test/score.test.js`

- [ ] **Step 1: Replace `test/score.test.js` entirely with:**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/score.test.js`
Expected: FAIL — the penalized case still yields 55 (duplication penalty present) and `breakdown.duplication` still exists.

- [ ] **Step 3: Replace `src/score.js` entirely with:**

```javascript
const SEVERITY_MULT = { high: 1.0, medium: 0.6, low: 0.3 };

function gradeFor(value) {
  if (value >= 90) return 'A';
  if (value >= 80) return 'B';
  if (value >= 70) return 'C';
  if (value >= 60) return 'D';
  return 'F';
}

export function scoreResult({ complexity, secrets }) {
  const secretsPenalty = -(secrets.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0));
  const complexityPenalty = -(complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0));
  const breakdown = {
    secrets: Number(secretsPenalty.toFixed(2)),
    complexity: Number(complexityPenalty.toFixed(2)),
  };
  const raw = 100 + breakdown.secrets + breakdown.complexity;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/score.test.js`
Expected: PASS (2 tests). Then run `node --test` — expect ALL PASS. (`scanner.js` still passes an extra `duplication` arg to `scoreResult`, which is harmlessly ignored; reporters still read `breakdown.duplication` only from their own fixtures.)

- [ ] **Step 5: Commit**

```bash
git add src/score.js test/score.test.js
git commit -m "refactor: drop duplication from scoring"
```

---

## Task 2: Remove duplication from the reporters

**Files:**
- Modify: `src/report/markdown.js`
- Modify: `src/report/html.js`
- Test: `test/report-markdown.test.js`
- Test: `test/report-html.test.js`

- [ ] **Step 1: Update `test/report-markdown.test.js`**

(a) In the `result` fixture (top of file), remove the `duplication: { percentage: 5, clusters: [] },` line and change the score breakdown to drop `duplication`:
```javascript
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3 } },
```

(b) In the `renders headline score and feature sections` test, remove this line:
```javascript
  assert.ok(md.includes('Duplication'));
```

(c) In the `escapes pipe characters in table cells` test fixture, remove the `duplication: { percentage: 0, clusters: [] },` line and change its score breakdown to:
```javascript
    score: { value: 50, grade: 'F', breakdown: { secrets: -50, complexity: 0 } },
```

(d) Delete the entire `renders duplication clusters with locations and a fenced snippet` test (the whole `test('renders duplication clusters ...', () => { ... });` block).

- [ ] **Step 2: Update `test/report-html.test.js`**

(a) In the top `result` fixture, remove the `duplication: { percentage: 5, clusters: [] },` line and change breakdown to:
```javascript
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3 } },
```

(b) In the `renders a skipped section` test fixture, remove the `duplication: { percentage: 0, clusters: [] },` line and change breakdown to:
```javascript
    score: { value: 100, grade: 'A', breakdown: { secrets: 0, complexity: 0 } },
```

(c) Delete the entire `renders duplication clusters as collapsible details with an escaped snippet` test block.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/report-markdown.test.js test/report-html.test.js`
Expected: FAIL — markdown still emits a `## Duplication` section (so removed-assertion tests pass) but the deleted-test references are gone; more importantly the reporters still contain the duplication code. Specifically the suite will FAIL only once code is changed out of sync — so it is acceptable if this step still passes. Proceed to Step 4 regardless; the goal is that after Step 5 the reporters no longer render duplication.

> Note: these test edits only remove duplication coverage; they do not by themselves fail against the old reporters. The real verification is Step 6 (no `Duplication` section in output).

- [ ] **Step 4: Edit `src/report/markdown.js`**

(a) Delete the `backtickFence` and `dupClusters` helper functions (the two functions between `table(...)` and `export function toMarkdown`).

(b) Change the destructure line from:
```javascript
  const { meta, summary, complexity, duplication, secrets, score, skipped } = result;
```
to:
```javascript
  const { meta, summary, complexity, secrets, score, skipped } = result;
```

(c) Change the Penalties line from:
```javascript
Penalties — secrets: ${score.breakdown.secrets}, complexity: ${score.breakdown.complexity}, duplication: ${score.breakdown.duplication}
```
to:
```javascript
Penalties — secrets: ${score.breakdown.secrets}, complexity: ${score.breakdown.complexity}
```

(d) Remove the Duplication section — these three lines (the heading, the body, and the trailing blank line before `## Secrets`):
```javascript
## Duplication: ${duplication.percentage}%
${dupClusters(duplication.clusters)}

```

- [ ] **Step 5: Edit `src/report/html.js`**

(a) Delete the `dupDetails` helper function (between `rows(...)` and `export function toHtml`).

(b) Change the destructure line from:
```javascript
  const { meta, summary, complexity, duplication, secrets, score, skipped } = result;
```
to:
```javascript
  const { meta, summary, complexity, secrets, score, skipped } = result;
```

(c) Remove the duplication-specific CSS line entirely:
```javascript
summary{cursor:pointer}details{margin:.4rem 0}pre{background:#f6f8fa;padding:8px;overflow:auto;font-size:12px}.dup-locs{font-size:13px;margin:4px 0;color:#555}
```

(d) Remove the Duplication `<section>` — these two lines:
```javascript
<section><h2>Duplication: ${duplication.percentage}%</h2>
${dupDetails(duplication.clusters)}</section>
```

- [ ] **Step 6: Verify reporters and run the suite**

Run: `node --test`
Expected: ALL PASS. Additionally confirm no duplication output:
```bash
node --input-type=module -e "import { toMarkdown } from './src/report/markdown.js'; const md = toMarkdown({ meta:{target:'x',scannedAt:'n',durationMs:1}, summary:{totalFiles:0,byLanguage:{},totalLines:0,code:0,comments:0,blanks:0,functions:0,classes:0}, complexity:{threshold:10,avg:0,max:0,flagged:[]}, secrets:{findings:[]}, score:{value:100,grade:'A',breakdown:{secrets:0,complexity:0}}, skipped:[] }); console.log(md.includes('Duplication') ? 'STILL THERE' : 'clean'); console.log(md.includes('undefined') ? 'HAS UNDEFINED' : 'no-undefined');"
```
Expected: prints `clean` then `no-undefined`.

- [ ] **Step 7: Commit**

```bash
git add src/report/markdown.js src/report/html.js test/report-markdown.test.js test/report-html.test.js
git commit -m "refactor: remove duplication section from markdown and html reports"
```

---

## Task 3: Remove duplication from the scanner

**Files:**
- Modify: `src/scanner.js`
- Test: `test/scanner.test.js`

- [ ] **Step 1: Add a failing assertion to `test/scanner.test.js`**

In the existing `produces a complete result object` test, add this line just before the test's closing `});`:
```javascript
  assert.ok(!('duplication' in r), 'duplication key must be removed from the result');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scanner.test.js`
Expected: FAIL — the scanner still returns a `duplication` key.

- [ ] **Step 3: Edit `src/scanner.js`**

(a) Remove the import line:
```javascript
import { findDuplication } from './analyzers/duplication.js';
```

(b) Remove the `dupEntries` declaration line:
```javascript
  const dupEntries = [];
```

(c) Remove the line that collects entries (inside the JS/TS branch):
```javascript
      dupEntries.push({ file, content, tokens: parsed.tokens });
```

(d) Remove the `findDuplication` call line:
```javascript
  const duplication = findDuplication(dupEntries);
```

(e) Change the score call from:
```javascript
  const score = scoreResult({ complexity, duplication, secrets });
```
to:
```javascript
  const score = scoreResult({ complexity, secrets });
```

(f) Change the returned object from:
```javascript
  return {
    meta: { target: rootDir, scannedAt: new Date().toISOString(), durationMs: Date.now() - start },
    summary, complexity, duplication, secrets, score, skipped,
  };
```
to:
```javascript
  return {
    meta: { target: rootDir, scannedAt: new Date().toISOString(), durationMs: Date.now() - start },
    summary, complexity, secrets, score, skipped,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scanner.test.js`
Expected: PASS. Then run `node --test` — expect ALL PASS. (`src/analyzers/duplication.js` still exists and `test/duplication.test.js` still passes — they are deleted in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "refactor: remove duplication from scanner pipeline and result"
```

---

## Task 4: Delete the analyzer, rule, and docs references

**Files:**
- Delete: `src/analyzers/duplication.js`
- Delete: `test/duplication.test.js`
- Delete: `.cursor/rules/code-duplication.mdc`
- Modify: `README.md`

- [ ] **Step 1: Delete the files**

```bash
cd /Users/Rotolonm/Dev/tmp/code-scanner
git rm src/analyzers/duplication.js test/duplication.test.js .cursor/rules/code-duplication.mdc
```

- [ ] **Step 2: Update `README.md`**

Remove this bullet from the Features list:
```markdown
- Code duplication (near-duplicate detection + percentage)
```

- [ ] **Step 3: Verify no duplication references remain in code/tests**

Run: `grep -rn "duplication\|findDuplication\|Duplication" src test`
Expected: no output (exit code 1 / empty).

- [ ] **Step 4: Run the full suite**

Run: `node --test`
Expected: ALL PASS, with the duplication test file gone.

- [ ] **Step 5: End-to-end self-scan**

```bash
node src/cli.js src --out scan-report --format json,md,html >/dev/null
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('scan-report/report.json','utf8')); console.log('has duplication key:', 'duplication' in j, '| score', j.score.value, j.score.grade, '| breakdown keys', Object.keys(j.score.breakdown).join(','))"
grep -c 'Duplication' scan-report/report.md scan-report/report.html
rm -rf scan-report
```
Expected: `has duplication key: false`, a valid score, breakdown keys `secrets,complexity`, and `grep -c 'Duplication'` reports `0` for both report files.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "chore: delete duplication analyzer, cursor rule, and README entry"
```

---

## Self-Review Notes

- **Spec coverage:** score change (T1), reporter removal + test updates (T2), scanner removal + result-shape (T3), file/rule/README deletion + grep-clean + self-scan (T4). Recomputed 65/D score case is in T1.
- **Ordering safety:** reporters stop reading `duplication` (T2) before the scanner stops emitting it (T3), so the CLI live-render test never hits a missing key. `duplication.js` is deleted (T4) only after its last importer is removed (T3).
- **Placeholder scan:** every code/test change shows full before/after text; no TBDs.
- **Type consistency:** `scoreResult({ complexity, secrets })` and result `{ meta, summary, complexity, secrets, score, skipped }` are used identically across T1–T3.
