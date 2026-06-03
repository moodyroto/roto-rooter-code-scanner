# P2 — Dependency Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal-module import graph, detect circular dependencies (Tarjan SCC), surface them in the result/score/reports.

**Architecture:** New `src/analyzers/dependencies.js` (`extractImports`, `resolveImport`, `analyzeDependencies`). Scanner collects static import specifiers per JS/TS file, resolves them against the scanned-file set, and runs SCC. Cycles penalize the score and render in a new Dependencies report section.

**Tech Stack:** Node v24, ESM, `@babel/traverse`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-03-dependency-analysis-design.md`

---

## Locked interfaces

```
src/analyzers/dependencies.js
  extractImports(ast) -> string[]                              // static import/export-from specifiers
  resolveImport(importerAbs, specifier, fileSet) -> string|null
  analyzeDependencies(entries, fileSet) -> { cycles, summary, mostImported }
    entries = [{ file, specifiers }]
    cycles = [{ files: [absPath,...] }]                         // SCC size>=2, plus self-imports
    summary = { modules, internalEdges, externalImports }
    mostImported = [{ file, importedBy }]                       // top 5 fan-in

src/score.js   scoreResult({ complexity, security, dependencies = { cycles: [] } })
               breakdown = { security, complexity, dependencies }
src/scanner.js result.dependencies = { cycles, summary, mostImported }
```

Penalty: `dependenciesPenalty = -Math.min(24, 8 * dependencies.cycles.length)`.

---

## Task 1: dependencies analyzer

**Files:**
- Create: `src/analyzers/dependencies.js`
- Test: `test/dependencies.test.js`

- [ ] **Step 1: Write the failing test** at `test/dependencies.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { extractImports, resolveImport, analyzeDependencies } from '../src/analyzers/dependencies.js';

test('extractImports collects static import/export-from, ignores require and dynamic import', () => {
  const src = [
    'import x from "./a";',
    'export { y } from "./b";',
    'export * from "./c";',
    'export const local = 1;',
    'const z = require("./d");',
    'const p = import("./e");',
  ].join('\n');
  const { ast } = parseFile(src, 'x.js');
  assert.deepEqual(extractImports(ast).sort(), ['./a', './b', './c']);
});

test('resolveImport resolves relative with extension and index, null for bare/unresolved', () => {
  const set = new Set(['/p/a.ts', '/p/dir/index.js']);
  assert.equal(resolveImport('/p/x.js', './a', set), '/p/a.ts');
  assert.equal(resolveImport('/p/x.js', './dir', set), '/p/dir/index.js');
  assert.equal(resolveImport('/p/x.js', 'react', set), null);
  assert.equal(resolveImport('/p/x.js', './missing', set), null);
});

test('analyzeDependencies detects a 2-file cycle and counts edges/externals', () => {
  const fileSet = new Set(['/p/a.js', '/p/b.js']);
  const entries = [
    { file: '/p/a.js', specifiers: ['./b', 'react'] },
    { file: '/p/b.js', specifiers: ['./a'] },
  ];
  const r = analyzeDependencies(entries, fileSet);
  assert.equal(r.cycles.length, 1);
  assert.deepEqual(r.cycles[0].files, ['/p/a.js', '/p/b.js']);
  assert.equal(r.summary.internalEdges, 2);
  assert.equal(r.summary.externalImports, 1);
  assert.equal(r.summary.modules, 2);
});

test('analyzeDependencies finds no cycle for an acyclic chain and ranks most-imported', () => {
  const fileSet = new Set(['/p/a.js', '/p/b.js', '/p/c.js']);
  const entries = [
    { file: '/p/a.js', specifiers: ['./b', './c'] },
    { file: '/p/b.js', specifiers: ['./c'] },
    { file: '/p/c.js', specifiers: [] },
  ];
  const r = analyzeDependencies(entries, fileSet);
  assert.equal(r.cycles.length, 0);
  assert.equal(r.mostImported[0].file, '/p/c.js');
  assert.equal(r.mostImported[0].importedBy, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dependencies.test.js`
Expected: FAIL (cannot find module `../src/analyzers/dependencies.js`)

- [ ] **Step 3: Write `src/analyzers/dependencies.js`:**

```javascript
import path from 'node:path';
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;

const EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];

export function extractImports(ast) {
  const specs = [];
  traverse(ast, {
    ImportDeclaration(p) { specs.push(p.node.source.value); },
    ExportNamedDeclaration(p) { if (p.node.source) specs.push(p.node.source.value); },
    ExportAllDeclaration(p) { specs.push(p.node.source.value); },
  });
  return specs;
}

export function resolveImport(importerAbs, specifier, fileSet) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const base = path.resolve(path.dirname(importerAbs), specifier);
  const candidates = [base];
  for (const ext of EXTS) candidates.push(base + ext);
  for (const ext of EXTS) candidates.push(path.join(base, `index${ext}`));
  for (const c of candidates) if (fileSet.has(c)) return c;
  return null;
}

export function analyzeDependencies(entries, fileSet) {
  const adj = new Map();      // file -> Set(target)
  const inDegree = new Map(); // file -> number of distinct importers
  let internalEdges = 0;
  let externalImports = 0;
  const selfImports = new Set();

  for (const f of fileSet) { adj.set(f, new Set()); inDegree.set(f, 0); }

  for (const { file, specifiers } of entries) {
    if (!adj.has(file)) adj.set(file, new Set());
    if (!inDegree.has(file)) inDegree.set(file, 0);
    for (const spec of specifiers) {
      const target = resolveImport(file, spec, fileSet);
      if (target === null) { externalImports += 1; continue; }
      internalEdges += 1;
      if (target === file) { selfImports.add(file); continue; }
      if (!adj.get(file).has(target)) {
        adj.get(file).add(target);
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }
  }

  // Tarjan's strongly connected components.
  let index = 0;
  const indices = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  const strongconnect = (v) => {
    indices.set(v, index); low.set(v, index); index += 1;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), indices.get(w))); }
    }
    if (low.get(v) === indices.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      sccs.push(comp);
    }
  };
  for (const v of adj.keys()) if (!indices.has(v)) strongconnect(v);

  const cycles = sccs.filter((c) => c.length >= 2).map((c) => ({ files: [...c].sort() }));
  for (const f of selfImports) cycles.push({ files: [f] });
  cycles.sort((a, b) => b.files.length - a.files.length);

  const mostImported = [...inDegree.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([file, importedBy]) => ({ file, importedBy }));

  return { cycles, summary: { modules: entries.length, internalEdges, externalImports }, mostImported };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dependencies.test.js`
Expected: PASS (4 tests). Then `node --test` — ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/dependencies.js test/dependencies.test.js
git commit -m "feat: dependency analyzer (imports, resolution, SCC cycles)"
```

---

## Task 2: Add dependency penalty to scoring

**Files:**
- Modify: `src/score.js`
- Test: `test/score.test.js` (append)

- [ ] **Step 1: Append a failing test to `test/score.test.js`:**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/score.test.js`
Expected: FAIL (`breakdown.dependencies` is undefined).

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

export function scoreResult({ complexity, security, dependencies = { cycles: [] } }) {
  const securityPenalty = -(security.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0));
  const complexityPenalty = -(complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0));
  const dependenciesPenalty = -Math.min(24, 8 * dependencies.cycles.length);
  const breakdown = {
    security: Number(securityPenalty.toFixed(2)),
    complexity: Number(complexityPenalty.toFixed(2)),
    dependencies: Number(dependenciesPenalty.toFixed(2)),
  };
  const raw = 100 + breakdown.security + breakdown.complexity + breakdown.dependencies;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/score.test.js`
Expected: PASS. Then `node --test` — ALL PASS. (The scanner still calls `scoreResult({ complexity, security })`; the `dependencies` default keeps it working with a 0 penalty until Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/score.js test/score.test.js
git commit -m "feat: penalize circular dependencies in score"
```

---

## Task 3: Wire dependency analysis into the scanner

**Files:**
- Modify: `src/scanner.js`
- Test: `test/scanner.test.js` (add assertions)

- [ ] **Step 1: Add failing assertions to `test/scanner.test.js`**

In the `produces a complete result object` test, add just before its closing `});`:
```javascript
  assert.ok('dependencies' in r, 'result has a dependencies section');
  assert.ok(Array.isArray(r.dependencies.cycles), 'dependencies.cycles is an array');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scanner.test.js`
Expected: FAIL (no `dependencies` key in the result).

- [ ] **Step 3: Edit `src/scanner.js`**

(a) Add the import after the security import line:
```javascript
import { extractImports, analyzeDependencies } from './analyzers/dependencies.js';
```

(b) Add an accumulator next to the others (after `const securityFindings = [];`):
```javascript
  const importEntries = [];
```

(c) In the parsed JS/TS branch, right after the `securityFindings.push(...scanDangerousCalls(parsed.ast, content, file));` line, add:
```javascript
      importEntries.push({ file, specifiers: extractImports(parsed.ast) });
```

(d) After the loop, before the `scoreResult` call, add:
```javascript
  const jsFiles = new Set(files.filter((f) => isJsTs(f)));
  const dependencies = analyzeDependencies(importEntries, jsFiles);
```

(e) Change `const score = scoreResult({ complexity, security });` to:
```javascript
  const score = scoreResult({ complexity, security, dependencies });
```

(f) Change the returned object line `    summary, complexity, security, score, skipped,` to:
```javascript
    summary, complexity, security, dependencies, score, skipped,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scanner.test.js`
Expected: PASS. Then `node --test` — ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "feat: wire dependency analysis into scanner result"
```

---

## Task 4: Dependencies section in the reporters

**Files:**
- Modify: `src/report/markdown.js`
- Modify: `src/report/html.js`
- Test: `test/report-markdown.test.js`, `test/report-html.test.js`

- [ ] **Step 1: Update report test fixtures and add cycle-render tests**

(a) In `test/report-markdown.test.js`: add a `dependencies` field to BOTH fixtures (the top `result` and the `r` inside the pipe-escape test). Insert after each `security:` line:
```javascript
  dependencies: { cycles: [], summary: { modules: 0, internalEdges: 0, externalImports: 0 }, mostImported: [] },
```
(use the matching indentation of the surrounding fixture). Then append this test:
```javascript
test('renders a dependencies section with a circular dependency', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 4, code: 4, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    security: { findings: [] },
    dependencies: {
      cycles: [{ files: ['src/a.js', 'src/b.js'] }],
      summary: { modules: 2, internalEdges: 2, externalImports: 1 },
      mostImported: [{ file: 'src/b.js', importedBy: 1 }],
    },
    score: { value: 92, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: -8 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('## Dependencies'));
  assert.ok(md.includes('Circular dependencies (1)'));
  assert.ok(md.includes('src/a.js, src/b.js'));
  assert.ok(md.includes('Most imported'));
});
```

(b) In `test/report-html.test.js`: add the same `dependencies` field to BOTH fixtures (after each `security:` line, matching indentation). Then append:
```javascript
test('renders a dependencies section with a circular dependency', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 4, code: 4, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    security: { findings: [] },
    dependencies: {
      cycles: [{ files: ['src/a.js', 'src/b.js'] }],
      summary: { modules: 2, internalEdges: 2, externalImports: 1 },
      mostImported: [{ file: 'src/b.js', importedBy: 1 }],
    },
    score: { value: 92, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: -8 } },
    skipped: [],
  };
  const html = toHtml(r);
  assert.ok(html.includes('Dependencies'));
  assert.ok(html.includes('src/a.js, src/b.js'));
  assert.ok(!html.includes('http://') && !html.includes('https://'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/report-markdown.test.js test/report-html.test.js`
Expected: FAIL — the new cycle-render tests fail (no Dependencies section yet).

- [ ] **Step 3: Edit `src/report/markdown.js`**

(a) Change the destructure line to:
```javascript
  const { meta, summary, complexity, security, dependencies, score, skipped } = result;
```

(b) Change the Penalties line to include dependencies:
```javascript
Penalties — security: ${score.breakdown.security}, complexity: ${score.breakdown.complexity}, dependencies: ${score.breakdown.dependencies}
```

(c) Insert a Dependencies section between the Cyclomatic Complexity section and the `## Security` section. After the complexity `${table(...)}` line and its following blank line, add:
```javascript
## Dependencies
Modules: ${dependencies.summary.modules} · Internal edges: ${dependencies.summary.internalEdges} · External imports: ${dependencies.summary.externalImports}

### Circular dependencies (${dependencies.cycles.length})
${table(['Cycle', 'Files'], dependencies.cycles.map((c, i) => [String(i + 1), c.files.join(', ')]))}

### Most imported
${table(['File', 'Imported by'], dependencies.mostImported.map((m) => [m.file, String(m.importedBy)]))}

```

- [ ] **Step 4: Edit `src/report/html.js`**

(a) Change the destructure line to:
```javascript
  const { meta, summary, complexity, security, dependencies, score, skipped } = result;
```

(b) Insert a Dependencies `<section>` between the Cyclomatic Complexity `</section>` and the Security `<section>`:
```javascript
<section><h2>Dependencies</h2>
<p>Modules: ${dependencies.summary.modules} · Internal edges: ${dependencies.summary.internalEdges} · External imports: ${dependencies.summary.externalImports}</p>
<h3>Circular dependencies (${dependencies.cycles.length})</h3>
${rows(['Cycle', 'Files'], dependencies.cycles.map((c, i) => [i + 1, c.files.join(', ')]))}
<h3>Most imported</h3>
${rows(['File', 'Imported by'], dependencies.mostImported.map((m) => [m.file, m.importedBy]))}</section>
```

- [ ] **Step 5: Run the suite**

Run: `node --test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/report/markdown.js src/report/html.js test/report-markdown.test.js test/report-html.test.js
git commit -m "feat: dependencies section in markdown and html reports"
```

---

## Task 5: Full suite + end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: ALL PASS.

- [ ] **Step 2: End-to-end — a real circular dependency**

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/src"
printf 'import { b } from "./b.js";\nexport const a = () => b;\n' > "$TMP/src/a.js"
printf 'import { a } from "./a.js";\nexport const b = () => a;\n' > "$TMP/src/b.js"
printf 'import { a } from "./a.js";\nimport React from "react";\nexport const c = a;\n' > "$TMP/src/c.js"
node src/cli.js "$TMP" --out "$TMP/r" --format json,md >/dev/null
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/r/report.json','utf8')); const d=j.dependencies; console.log('cycles:', d.cycles.length, JSON.stringify(d.cycles.map(c=>c.files.map(f=>f.split('/').pop())))); console.log('summary:', JSON.stringify(d.summary)); console.log('mostImported:', JSON.stringify(d.mostImported.map(m=>m.file.split('/').pop()+':'+m.importedBy))); console.log('score', j.score.value, j.score.grade, '| dep penalty', j.score.breakdown.dependencies)"
echo -n "Dependencies section in md: "; grep -c '## Dependencies' "$TMP/r/report.md"
rm -rf "$TMP"
```
Expected: one cycle containing `a.js` and `b.js`; `summary.externalImports` ≥ 1 (the `react` import); `mostImported` lists `a.js` (imported by b and c); a `dependencies` penalty of `-8`; and the Markdown shows a `## Dependencies` section.

- [ ] **Step 3: No commit (verification only)**

```bash
git status --short
```

---

## Self-Review Notes

- **Spec coverage:** analyzer with extractImports/resolveImport/analyzeDependencies + Tarjan SCC (T1); score penalty + default (T2); scanner wiring incl. jsFiles set and result key (T3); reporters Dependencies section + tests (T4); e2e with a real cycle (T5).
- **Green at each task:** `score.js` defaults `dependencies` so it tolerates the pre-wired scanner (T2 before T3); reporters change after the scanner produces the key, and fixtures gain `dependencies` in the same task (T4).
- **Type consistency:** `{ cycles, summary:{modules,internalEdges,externalImports}, mostImported:[{file,importedBy}] }` produced in T1, consumed by score (cycles.length), scanner, and both reporters identically.
- **Consistency:** both reporters use `dependencies.summary.modules` for the module count (JS/TS modules), matching the JSON.
