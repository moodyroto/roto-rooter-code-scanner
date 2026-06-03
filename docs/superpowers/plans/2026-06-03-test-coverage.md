# P3 — Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report a static test-coverage heuristic — the ratio of source modules with an associated test (path-aware name convention) plus the untested list — penalizing low coverage in the score.

**Architecture:** New `src/analyzers/coverage.js` (`testTargetKey`, `moduleKey`, `analyzeCoverage`) keyed on `"<dir>::<stem>"`. Scanner gathers test files via a second `traverse(includeTests:true)`, matches them path-aware to source modules. Coverage penalizes the score and renders in a new Test Coverage report section.

**Tech Stack:** Node v24, ESM, `node:test`. No AST, no new deps.

**Spec:** `docs/superpowers/specs/2026-06-03-test-coverage-design.md`

---

## Locked interfaces

```
src/analyzers/coverage.js
  testTargetKey(file) -> "<dir>::<stem>" | null    // test file's target module key
  moduleKey(file) -> "<dir>::<stem>"                // source module key
  analyzeCoverage(sourceFiles, testFiles) -> { totalModules, testedModules, ratio, untested }

src/score.js   scoreResult({ complexity, security, dependencies = { cycles: [] }, coverage = { ratio: 1 } })
               breakdown = { security, complexity, dependencies, coverage }
src/scanner.js result.coverage = { totalModules, testedModules, ratio, untested }
```

Penalty: `coveragePenalty = -Math.round(20 * (1 - coverage.ratio))`.

---

## Task 1: coverage analyzer

**Files:**
- Create: `src/analyzers/coverage.js`
- Test: `test/coverage.test.js`

- [ ] **Step 1: Write the failing test** at `test/coverage.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTargetKey, moduleKey, analyzeCoverage } from '../src/analyzers/coverage.js';

test('testTargetKey derives module key from test conventions', () => {
  assert.equal(testTargetKey('/p/x/foo.test.ts'), '/p/x::foo');
  assert.equal(testTargetKey('/p/x/foo.spec.jsx'), '/p/x::foo');
  assert.equal(testTargetKey('/p/x/__tests__/foo.ts'), '/p/x::foo');
  assert.equal(testTargetKey('/p/x/__tests__/foo.test.ts'), '/p/x::foo');
  assert.equal(testTargetKey('/p/__mocks__/x.js'), null);
  assert.equal(testTargetKey('/p/plain.ts'), null);
});

test('moduleKey is dir::stem', () => {
  assert.equal(moduleKey('/p/x/foo.ts'), '/p/x::foo');
});

test('analyzeCoverage marks tested/untested and computes ratio', () => {
  const r = analyzeCoverage(['/p/a.js', '/p/b.js'], ['/p/a.test.js']);
  assert.equal(r.totalModules, 2);
  assert.equal(r.testedModules, 1);
  assert.equal(r.ratio, 0.5);
  assert.deepEqual(r.untested, ['/p/b.js']);
});

test('analyzeCoverage is path-aware (different dir does not credit)', () => {
  const r = analyzeCoverage(['/p/x/foo.ts'], ['/p/y/foo.test.js']);
  assert.equal(r.testedModules, 0);
  assert.deepEqual(r.untested, ['/p/x/foo.ts']);
});

test('analyzeCoverage ratio is 1 for an empty project', () => {
  const r = analyzeCoverage([], []);
  assert.equal(r.ratio, 1);
  assert.equal(r.totalModules, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/coverage.test.js`
Expected: FAIL (cannot find module `../src/analyzers/coverage.js`)

- [ ] **Step 3: Write `src/analyzers/coverage.js`:**

```javascript
const TEST_INFIX = /^(.+)\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const JSTS_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;

// The source-module key ("<dir>::<stem>") a test file targets, or null if it is not a unit test.
export function testTargetKey(file) {
  const parts = file.split(/[\\/]/);
  const base = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  const m = base.match(TEST_INFIX);
  let stem;
  if (m) stem = m[1];
  else if (dirParts[dirParts.length - 1] === '__tests__') stem = base.replace(JSTS_EXT, '');
  else return null;
  const moduleDir = dirParts[dirParts.length - 1] === '__tests__' ? dirParts.slice(0, -1) : dirParts;
  return `${moduleDir.join('/')}::${stem}`;
}

// The key ("<dir>::<stem>") for a source module.
export function moduleKey(file) {
  const parts = file.split(/[\\/]/);
  const base = parts[parts.length - 1];
  return `${parts.slice(0, -1).join('/')}::${base.replace(JSTS_EXT, '')}`;
}

export function analyzeCoverage(sourceFiles, testFiles) {
  const targets = new Set();
  for (const t of testFiles) {
    const key = testTargetKey(t);
    if (key) targets.add(key);
  }
  const untested = [];
  let testedModules = 0;
  for (const f of sourceFiles) {
    if (targets.has(moduleKey(f))) testedModules += 1;
    else untested.push(f);
  }
  const totalModules = sourceFiles.length;
  const ratio = totalModules ? Number((testedModules / totalModules).toFixed(2)) : 1;
  return { totalModules, testedModules, ratio, untested };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/coverage.test.js`
Expected: PASS (5 tests). Then `node --test` — ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/coverage.js test/coverage.test.js
git commit -m "feat: test-coverage analyzer (path-aware name convention)"
```

---

## Task 2: Add coverage penalty to scoring

**Files:**
- Modify: `src/score.js`
- Test: `test/score.test.js` (append)

- [ ] **Step 1: Append failing tests to `test/score.test.js`:**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/score.test.js`
Expected: FAIL (`breakdown.coverage` is undefined).

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

export function scoreResult({ complexity, security, dependencies = { cycles: [] }, coverage = { ratio: 1 } }) {
  const securityPenalty = -(security.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0));
  const complexityPenalty = -(complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0));
  const dependenciesPenalty = -Math.min(24, 8 * dependencies.cycles.length);
  const coveragePenalty = -Math.round(20 * (1 - coverage.ratio));
  const breakdown = {
    security: Number(securityPenalty.toFixed(2)),
    complexity: Number(complexityPenalty.toFixed(2)),
    dependencies: Number(dependenciesPenalty.toFixed(2)),
    coverage: Number(coveragePenalty.toFixed(2)),
  };
  const raw = 100 + breakdown.security + breakdown.complexity + breakdown.dependencies + breakdown.coverage;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/score.test.js`
Expected: PASS. Then `node --test` — ALL PASS. (Scanner still calls `scoreResult({ complexity, security, dependencies })`; the `coverage` default keeps it at 0 penalty until Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/score.js test/score.test.js
git commit -m "feat: penalize low test coverage in score"
```

---

## Task 3: Wire coverage into the scanner

**Files:**
- Modify: `src/scanner.js`
- Test: `test/scanner.test.js` (add assertions)

- [ ] **Step 1: Add failing assertions to `test/scanner.test.js`**

In the `produces a complete result object` test, add just before its closing `});`:
```javascript
  assert.ok('coverage' in r, 'result has a coverage section');
  assert.equal(typeof r.coverage.ratio, 'number');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scanner.test.js`
Expected: FAIL (no `coverage` key in result).

- [ ] **Step 3: Edit `src/scanner.js`**

(a) Add two imports after the dependencies import line (`import { extractImports, analyzeDependencies } from './analyzers/dependencies.js';`):
```javascript
import { isTestFile } from './test-files.js';
import { analyzeCoverage } from './analyzers/coverage.js';
```

(b) After the existing `const dependencies = analyzeDependencies(importEntries, jsFiles);` line, add:
```javascript
  const withTests = traverse(rootDir, { ignore, gitignore, includeTests: true });
  const testFiles = withTests.filter((f) => isJsTs(f) && isTestFile(f));
  const coverage = analyzeCoverage([...jsFiles], testFiles);
```

(c) Change `const score = scoreResult({ complexity, security, dependencies });` to:
```javascript
  const score = scoreResult({ complexity, security, dependencies, coverage });
```

(d) Change the returned object line `    summary, complexity, security, dependencies, score, skipped,` to:
```javascript
    summary, complexity, security, dependencies, coverage, score, skipped,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scanner.test.js`
Expected: PASS. Then `node --test` — ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "feat: wire test coverage into scanner result"
```

---

## Task 4: Test Coverage section in the reporters

**Files:**
- Modify: `src/report/markdown.js`
- Modify: `src/report/html.js`
- Test: `test/report-markdown.test.js`, `test/report-html.test.js`

- [ ] **Step 1: Update report test fixtures and add render tests**

(a) In `test/report-markdown.test.js`, add a `coverage` field to EACH of the three fixtures (the top `const result`, the `const r` in the pipe-escape test, and the `const r` in the dependencies-render test), inserted after each fixture's `dependencies:` entry, with matching indentation, and add `coverage: 0` to each fixture's `score.breakdown`:
```javascript
  coverage: { totalModules: 0, testedModules: 0, ratio: 1, untested: [] },
```
Then APPEND this test:
```javascript
test('renders a test coverage section with untested modules', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 4, code: 4, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    security: { findings: [] },
    dependencies: { cycles: [], summary: { modules: 2, internalEdges: 0, externalImports: 0 }, mostImported: [] },
    coverage: { totalModules: 2, testedModules: 1, ratio: 0.5, untested: ['src/b.js'] },
    score: { value: 90, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: 0, coverage: -10 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('## Test Coverage'));
  assert.ok(md.includes('50%'));
  assert.ok(md.includes('tested 1 / 2 modules'));
  assert.ok(md.includes('src/b.js'));
});
```

(b) In `test/report-html.test.js`, add the same `coverage` field to EACH of the three fixtures (after each `dependencies:` entry, matching indentation) and `coverage: 0` to each `score.breakdown`. Then APPEND:
```javascript
test('renders a test coverage section', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 4, code: 4, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    security: { findings: [] },
    dependencies: { cycles: [], summary: { modules: 2, internalEdges: 0, externalImports: 0 }, mostImported: [] },
    coverage: { totalModules: 2, testedModules: 1, ratio: 0.5, untested: ['src/b.js'] },
    score: { value: 90, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: 0, coverage: -10 } },
    skipped: [],
  };
  const html = toHtml(r);
  assert.ok(html.includes('Test Coverage'));
  assert.ok(html.includes('50%'));
  assert.ok(html.includes('src/b.js'));
  assert.ok(!html.includes('http://') && !html.includes('https://'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/report-markdown.test.js test/report-html.test.js`
Expected: FAIL — the new render tests fail (no Test Coverage section yet).

- [ ] **Step 3: Edit `src/report/markdown.js`**

(a) Change the destructure line to:
```javascript
  const { meta, summary, complexity, security, dependencies, coverage, score, skipped } = result;
```

(b) Change the Penalties line to:
```javascript
Penalties — security: ${score.breakdown.security}, complexity: ${score.breakdown.complexity}, dependencies: ${score.breakdown.dependencies}, coverage: ${score.breakdown.coverage}
```

(c) Insert a Test Coverage section between the `## Dependencies` section block and the `## Security` line. Immediately before `## Security`, add:
```javascript
## Test Coverage
Coverage: ${Math.round(coverage.ratio * 100)}% — tested ${coverage.testedModules} / ${coverage.totalModules} modules

### Untested modules (${coverage.untested.length})
${table(['File'], coverage.untested.slice(0, 50).map((f) => [f]))}

```

- [ ] **Step 4: Edit `src/report/html.js`**

(a) Change the destructure line to:
```javascript
  const { meta, summary, complexity, security, dependencies, coverage, score, skipped } = result;
```

(b) Insert a Test Coverage `<section>` between the Dependencies `</section>` and the Security `<section>`:
```javascript
<section><h2>Test Coverage</h2>
<p>Coverage: ${Math.round(coverage.ratio * 100)}% — tested ${coverage.testedModules} / ${coverage.totalModules} modules</p>
${rows(['Untested module'], coverage.untested.slice(0, 50).map((f) => [f]))}</section>
```

- [ ] **Step 5: Run the suite**

Run: `node --test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/report/markdown.js src/report/html.js test/report-markdown.test.js test/report-html.test.js
git commit -m "feat: test coverage section in markdown and html reports"
```

---

## Task 5: Full suite + end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: ALL PASS.

- [ ] **Step 2: End-to-end — partial coverage**

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/src"
printf 'export const a = 1;\n' > "$TMP/src/a.js"
printf 'import { a } from "./a.js";\nassert(a);\n' > "$TMP/src/a.test.js"
printf 'export const b = 2;\n' > "$TMP/src/b.js"
node src/cli.js "$TMP" --out "$TMP/r" --format json,md >/dev/null
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/r/report.json','utf8')); const c=j.coverage; console.log('ratio', c.ratio, '| tested', c.testedModules, '/', c.totalModules, '| untested', JSON.stringify(c.untested.map(f=>f.split('/').pop()))); console.log('score', j.score.value, j.score.grade, '| coverage penalty', j.score.breakdown.coverage)"
echo -n "## Test Coverage in md: "; grep -c '## Test Coverage' "$TMP/r/report.md"
rm -rf "$TMP"
```
Expected: `a.test.js` is excluded from modules (test file), `a.js` is tested, `b.js` untested → `ratio 0.5`, `tested 1 / 2`, `untested ["b.js"]`, a `coverage` penalty of `-10`, and a `## Test Coverage` section in the Markdown.

- [ ] **Step 3: No commit (verification only)**

```bash
git status --short
```

---

## Self-Review Notes

- **Spec coverage:** analyzer testTargetKey/moduleKey/analyzeCoverage incl. path-aware + `__tests__`/`__mocks__` (T1); score penalty + default (T2); scanner second-traversal wiring + result key (T3); reporters Test Coverage section + tests (T4); e2e partial coverage (T5).
- **Green at each task:** `score.js` defaults `coverage` (T2 before T3); reporters change after the scanner produces the key and fixtures gain `coverage` in the same task (T4).
- **Type consistency:** `{ totalModules, testedModules, ratio, untested }` produced in T1, consumed by score (`ratio`), scanner, and both reporters identically.
- **Note:** `a.test.js` is correctly NOT a module (the main traverse excludes it); it is discovered only by the second `includeTests:true` traversal and used as a test signal, not a module.
