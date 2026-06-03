# P3 — Test Coverage — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending written-spec review)
**Part of:** P3 (final) of the P0–P3 rework. Builds on P0–P2.

## 1. Goal

Report a static test-coverage heuristic: the ratio of source modules that have an
associated test, plus the list of untested modules. Low coverage penalizes the
score. This is NOT execution/line coverage — no tests are run or instrumented;
it is a filename-convention association between source modules and test files.

## 2. Decisions

| Decision | Choice |
|----------|--------|
| Coverage unit | Source modules (non-test JS/TS files) |
| Tested signal | Name convention (a test file targets the module) |
| Match precision | Path-aware: test must be in the module's directory or that directory's `__tests__/` |
| Test discovery | A second `traverse(..., { includeTests: true })`, filtered by `isTestFile` |
| Scoring | `coveragePenalty = -Math.round(20 * (1 - ratio))` (0 when ratio = 1) |
| `__mocks__` | Not treated as tests |

## 3. Module: `src/analyzers/coverage.js`

Pure path logic; no AST. Keys are `"<dir>::<stem>"` where `dir` is the absolute
module directory and `stem` is the basename without its JS/TS extension.

```javascript
import path from 'node:path';

const TEST_INFIX = /^(.+)\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const JSTS_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;

// Key a test file targets ("<moduleDir>::<stem>"), or null if it is not a unit test.
export function testTargetKey(file) {
  const parts = file.split(/[\\/]/);
  const base = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  const m = base.match(TEST_INFIX);
  let stem;
  if (m) stem = m[1];
  else if (dirParts[dirParts.length - 1] === '__tests__') stem = base.replace(JSTS_EXT, '');
  else return null; // not an infix test and not under __tests__ (e.g. __mocks__)
  const moduleDir = dirParts[dirParts.length - 1] === '__tests__' ? dirParts.slice(0, -1) : dirParts;
  return `${moduleDir.join('/')}::${stem}`;
}

// Key for a source module ("<dir>::<stem>").
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

### Matching behavior
- Co-located: `D/foo.test.ts` → `D::foo`; source `D/foo.ts` → `D::foo` → tested.
- `__tests__`: `D/__tests__/foo.ts` or `D/__tests__/foo.test.ts` → `D::foo` (the
  `__tests__` segment is stripped to the parent module dir).
- A test in a different directory does NOT credit a same-named module elsewhere.
- `__mocks__/x.js` and non-test files → `null` (no target).
- Paths are absolute (both source and test files come from `traverse`), so
  directory comparison is exact.

## 4. Scanner integration (`src/scanner.js`)

- `sourceFiles = files.filter((f) => isJsTs(f))` (the main traverse already excludes
  tests).
- Gather tests via a second traversal:
  ```javascript
  const withTests = traverse(rootDir, { ignore, gitignore, includeTests: true });
  const testFiles = withTests.filter((f) => isJsTs(f) && isTestFile(f));
  ```
  (`isTestFile` from `./test-files.js`.)
- `const coverage = analyzeCoverage(sourceFiles, testFiles);`
- `const score = scoreResult({ complexity, security, dependencies, coverage });`
- Add `coverage` to the returned result object.

Result shape: `{ meta, summary, complexity, security, dependencies, coverage, score, skipped }`.

## 5. Scoring (`src/score.js`)

- Signature `scoreResult({ complexity, security, dependencies = { cycles: [] }, coverage = { ratio: 1 } })`.
- `coveragePenalty = -Math.round(20 * (1 - coverage.ratio))`.
- `breakdown = { security, complexity, dependencies, coverage }`.
- `raw = 100 + security + complexity + dependencies + coverage`. Clamp `[0,100]`,
  round; grades unchanged. (Default `{ ratio: 1 }` → 0 penalty, so callers that omit
  coverage are unaffected.)

## 6. Reporters

New **"Test Coverage"** section, placed after Dependencies (before Security).

- **Markdown:**
  ```
  ## Test Coverage
  Coverage: <pct>% — tested <testedModules> / <totalModules> modules

  ### Untested modules (<count>)
  <table: File>           // top 50; "_none_" when empty
  ```
  where `<pct> = round(ratio * 100)`.
- **HTML:** `<h2>Test Coverage</h2>`, the same summary line, and an untested-modules
  table (top 50), all via `esc`.

## 7. Error handling / edge cases

- Empty project (no source modules) → `ratio = 1`, `untested = []`, penalty 0.
- No test files → every module untested → `ratio = 0` → penalty −20.
- The second traversal uses the same `ignore`/`gitignore` options, so tests under
  ignored/gitignored paths are not counted.
- Pure path predicate; no throw on normal input.

## 8. Testing

**`test/coverage.test.js`:**
- `testTargetKey`: `/p/x/foo.test.ts` → `/p/x::foo`; `/p/x/__tests__/foo.ts` →
  `/p/x::foo`; `/p/x/__tests__/foo.test.ts` → `/p/x::foo`; `/p/__mocks__/x.js` →
  `null`; `/p/plain.ts` → `null`.
- `moduleKey`: `/p/x/foo.ts` → `/p/x::foo`.
- `analyzeCoverage`:
  - `['/p/a.js', '/p/b.js']` with test `['/p/a.test.js']` → tested 1, untested
    `['/p/b.js']`, ratio 0.5.
  - path-aware: source `/p/x/foo.ts` is NOT tested by `/p/y/foo.test.js`.
  - empty sources → ratio 1.

**`test/score.test.js`** — add a coverage case: `ratio: 0.4` → `breakdown.coverage`
−12; `ratio: 1` (or omitted) → 0.

**`test/scanner.test.js`** — assert `'coverage' in r` and that
`typeof r.coverage.ratio === 'number'`.

**`test/report-markdown.test.js` / `test/report-html.test.js`** — fixtures gain a
`coverage` object; assert the Test Coverage section and the percentage render.

End-to-end: a dir with `a.js`, `a.test.js`, `b.js` → `coverage.ratio` 0.5,
`b.js` listed untested, a coverage penalty of −10, and a Test Coverage section.

## 9. Out of scope (YAGNI)

- Real execution/line/branch coverage (running tests, instrumentation).
- Function- or export-level coverage.
- Import-based "tested" detection (we chose name convention).
- Excluding entry points / type-only / barrel files from the denominator.
- Configurable coverage weight or cap.
