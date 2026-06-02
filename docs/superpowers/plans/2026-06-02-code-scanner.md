# Code Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node CLI that scans a JS/TS codebase and reports quality via metrics, three analyzers (cyclomatic complexity, duplication, secrets), a 0–100 score, and JSON/Markdown/HTML reports.

**Architecture:** A thin CLI over a `scan → analyze → report` pipeline. Each analyzer is an isolated ESM module with a pure function interface, unit-tested with `node:test`. JSON is the canonical result; Markdown and HTML render from it.

**Tech Stack:** Node v24, ESM, `@babel/parser` + `@babel/traverse`, `node:test`, inline SVG for charts.

---

## Module Interfaces (locked contracts)

Every task implements against these signatures. Do not rename.

```
src/languages.js
  detectLanguage(filePath) -> string | null        // "JavaScript", "TypeScript", "JSON", ...
  isJsTs(filePath) -> boolean
  LANGUAGE_BY_EXT: Record<ext, string>

src/traverse.js
  traverse(rootDir, { ignore = [] }) -> string[]    // absolute file paths, ignores applied

src/metrics/lines.js
  lineMetrics(content, commentLineSet = new Set()) -> { total, code, comments, blanks }

src/analyzers/ast.js
  parseFile(content, filePath) -> { ast, comments, tokens } | { parseError: true, message }
  countDefinitions(ast) -> { functions, classes }
  commentLineNumbers(comments) -> Set<number>

src/analyzers/complexity.js
  fileComplexity(ast) -> { functions: [{ name, line, score, band }] }
  bandFor(score) -> "ok" | "refactor" | "high-risk"

src/analyzers/duplication.js
  normalizeLines(content, tokens) -> [{ n, norm, raw }]    // code lines only
  findDuplication(fileEntries, { minLines = 5 } = {}) -> { percentage, clusters }
    // fileEntries: [{ file, content, tokens }]
    // clusters: [{ lines, kind: "exact"|"near", occurrences: [{ file, startLine, endLine }] }]

src/analyzers/secrets.js
  scanSecrets(content, filePath) -> [{ file, line, rule, severity, excerpt }]
  SECRET_RULES: [{ name, severity, regex }]

src/score.js
  scoreResult({ complexity, duplication, secrets }) -> { value, grade, breakdown }

src/scanner.js
  scan(rootDir, { threshold = 10, ignore = [] }) -> ResultObject

src/report/json.js      toJson(result) -> string
src/report/markdown.js  toMarkdown(result) -> string
src/report/html.js      toHtml(result) -> string

src/cli.js
  parseArgs(argv) -> { directory, out, formats, threshold, ignore }
  main(argv) -> Promise<number>   // returns exit code

src/index.js  re-exports: scan, toJson, toMarkdown, toHtml
```

**ResultObject shape** (built by `scan`):
```jsonc
{
  "meta": { "target", "scannedAt", "durationMs" },
  "summary": { "totalFiles", "byLanguage", "totalLines", "code", "comments", "blanks", "functions", "classes" },
  "complexity": { "threshold", "avg", "max", "flagged": [{ "file","line","name","score","band" }] },
  "duplication": { "percentage", "clusters": [...] },
  "secrets": { "findings": [...] },
  "score": { "value", "grade", "breakdown" },
  "skipped": [{ "file", "reason" }]
}
```

**Scoring weights (pinned):** start 100.
- Secrets: `-15 * severityMult` per finding (`high`=1.0, `medium`=0.6, `low`=0.3).
- Complexity: `-3` per `refactor` function, `-8` per `high-risk` function.
- Duplication: `-(percentage * 0.5)`, capped at `-25`.
- Clamp to `[0,100]`. Grades: A≥90, B≥80, C≥70, D≥60, else F.

---

## Task 1: Project setup

**Files:**
- Create: `.gitignore`
- Modify: `package.json`
- Create: `src/.gitkeep`

- [ ] **Step 1: Initialize git and install dependencies**

```bash
cd /Users/Rotolonm/Dev/tmp/code-scanner
git init
npm pkg set type=module
npm pkg set bin.code-scanner=src/cli.js
npm pkg set scripts.test="node --test"
npm pkg set scripts.scan="node src/cli.js"
npm install @babel/parser @babel/traverse
```

Expected: `node_modules/` populated, `package.json` has `"type": "module"`.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
scan-report/
*.log
```

- [ ] **Step 3: Verify Node and ESM work**

Run: `node --input-type=module -e "import {parse} from '@babel/parser'; console.log(typeof parse)"`
Expected: prints `function`

- [ ] **Step 4: Commit**

```bash
mkdir -p src && touch src/.gitkeep
git add -A
git commit -m "chore: project setup (ESM, babel, node:test)"
```

---

## Task 2: Language detection

**Files:**
- Create: `src/languages.js`
- Test: `test/languages.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/languages.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, isJsTs } from '../src/languages.js';

test('detects JS/TS family by extension', () => {
  assert.equal(detectLanguage('a/b.js'), 'JavaScript');
  assert.equal(detectLanguage('a/b.tsx'), 'TypeScript');
  assert.equal(detectLanguage('a/b.json'), 'JSON');
  assert.equal(detectLanguage('a/b.unknownext'), null);
});

test('isJsTs is true only for JS/TS family', () => {
  assert.equal(isJsTs('x.ts'), true);
  assert.equal(isJsTs('x.json'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/languages.test.js`
Expected: FAIL (cannot find module `../src/languages.js`)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/languages.js
import path from 'node:path';

export const LANGUAGE_BY_EXT = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.json': 'JSON', '.md': 'Markdown', '.css': 'CSS', '.html': 'HTML', '.yml': 'YAML', '.yaml': 'YAML',
};

const JS_TS = new Set(['JavaScript', 'TypeScript']);

export function detectLanguage(filePath) {
  return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] ?? null;
}

export function isJsTs(filePath) {
  return JS_TS.has(detectLanguage(filePath));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/languages.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/languages.js test/languages.test.js
git commit -m "feat: language detection by extension"
```

---

## Task 3: Directory traversal

**Files:**
- Create: `src/traverse.js`
- Test: `test/traverse.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/traverse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { traverse } from '../src/traverse.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trav-'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1');
  fs.writeFileSync(path.join(dir, 'node_modules', 'b.js'), '1');
  fs.writeFileSync(path.join(dir, 'readme.md'), '1');
  return dir;
}

test('walks recursively and skips default ignores', () => {
  const dir = fixture();
  const files = traverse(dir, {}).map((f) => path.relative(dir, f));
  assert.ok(files.includes(path.join('src', 'a.js')));
  assert.ok(files.includes('readme.md'));
  assert.ok(!files.some((f) => f.includes('node_modules')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/traverse.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/traverse.js
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.cursor', 'scan-report',
]);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.lock', '.woff', '.woff2']);

export function traverse(rootDir, { ignore = [] } = {}) {
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...ignore]);
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignoreSet.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !BINARY_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/traverse.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/traverse.js test/traverse.test.js
git commit -m "feat: recursive traversal with ignore patterns"
```

---

## Task 4: Line metrics

**Files:**
- Create: `src/metrics/lines.js`
- Test: `test/lines.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/lines.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineMetrics } from '../src/metrics/lines.js';

test('splits total/code/comments/blanks', () => {
  const content = 'const a = 1;\n\n// note\nconst b = 2;\n';
  const m = lineMetrics(content, new Set([3])); // line 3 is a comment
  assert.equal(m.total, 4);
  assert.equal(m.blanks, 1);
  assert.equal(m.comments, 1);
  assert.equal(m.code, 2);
});

test('no comment set means all non-blank lines are code', () => {
  const m = lineMetrics('a\n\nb\n');
  assert.equal(m.code, 2);
  assert.equal(m.comments, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lines.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/metrics/lines.js
export function lineMetrics(content, commentLineSet = new Set()) {
  const lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // ignore trailing newline
  let blanks = 0, comments = 0, code = 0;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.trim() === '') blanks += 1;
    else if (commentLineSet.has(n)) comments += 1;
    else code += 1;
  });
  return { total: lines.length, code, comments, blanks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lines.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/metrics/lines.js test/lines.test.js
git commit -m "feat: line metrics (code/comments/blanks)"
```

---

## Task 5: AST parsing and definition counts

**Files:**
- Create: `src/analyzers/ast.js`
- Test: `test/ast.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/ast.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile, countDefinitions, commentLineNumbers } from '../src/analyzers/ast.js';

test('parses TS and counts functions and classes', () => {
  const src = 'class A {}\nfunction f(x: number) { return x; }\nconst g = () => 1;\n';
  const r = parseFile(src, 'x.ts');
  assert.ok(!r.parseError);
  const { functions, classes } = countDefinitions(r.ast);
  assert.equal(classes, 1);
  assert.equal(functions, 2); // function decl + arrow
});

test('returns parseError on broken input', () => {
  const r = parseFile('function (', 'x.js');
  assert.equal(r.parseError, true);
});

test('commentLineNumbers maps comment lines', () => {
  const r = parseFile('// hi\nconst a = 1;\n', 'x.js');
  assert.deepEqual([...commentLineNumbers(r.comments)], [1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ast.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/analyzers/ast.js
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default ?? _traverse;

export function parseFile(content, filePath) {
  try {
    const ast = parse(content, {
      sourceType: 'unambiguous',
      tokens: true,
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });
    return { ast, comments: ast.comments ?? [], tokens: ast.tokens ?? [] };
  } catch (err) {
    return { parseError: true, message: err.message };
  }
}

export function countDefinitions(ast) {
  let functions = 0, classes = 0;
  traverse(ast, {
    'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod'() {
      functions += 1;
    },
    'ClassDeclaration|ClassExpression'() { classes += 1; },
  });
  return { functions, classes };
}

export function commentLineNumbers(comments) {
  const set = new Set();
  for (const c of comments) {
    for (let n = c.loc.start.line; n <= c.loc.end.line; n += 1) set.add(n);
  }
  return set;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ast.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/ast.js test/ast.test.js
git commit -m "feat: AST parsing, definition counts, comment lines"
```

---

## Task 6: Cyclomatic complexity

**Files:**
- Create: `src/analyzers/complexity.js`
- Test: `test/complexity.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/complexity.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { fileComplexity, bandFor } from '../src/analyzers/complexity.js';

test('counts decision points (base 1 + branches)', () => {
  const src = `function f(a, b) {
    if (a) { return 1; }
    else if (b && a) { return 2; }
    for (let i = 0; i < 3; i++) {}
    return a ? 1 : 2;
  }`;
  const { ast } = parseFile(src, 'x.js');
  const { functions } = fileComplexity(ast);
  assert.equal(functions.length, 1);
  // base1 + if1 + elseif1 + &&1 + for1 + ternary1 = 6
  assert.equal(functions[0].score, 6);
  assert.equal(functions[0].name, 'f');
});

test('bandFor maps score to band', () => {
  assert.equal(bandFor(5), 'ok');
  assert.equal(bandFor(15), 'refactor');
  assert.equal(bandFor(25), 'high-risk');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/complexity.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/analyzers/complexity.js
import _traverse from '@babel/traverse';
const traverse = _traverse.default ?? _traverse;

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);

export function bandFor(score) {
  if (score <= 10) return 'ok';
  if (score <= 20) return 'refactor';
  return 'high-risk';
}

function functionName(node) {
  if (node.id?.name) return node.id.name;
  if (node.key?.name) return node.key.name;
  return '<anonymous>';
}

function complexityOf(fnPath) {
  let score = 1;
  fnPath.traverse({
    'IfStatement|ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement|SwitchCase|CatchClause|ConditionalExpression'(p) {
      if (p.isSwitchCase() && p.node.test === null) return; // default case adds nothing
      score += 1;
    },
    LogicalExpression(p) {
      if (p.node.operator === '&&' || p.node.operator === '||' || p.node.operator === '??') score += 1;
    },
  });
  return score;
}

export function fileComplexity(ast) {
  const functions = [];
  traverse(ast, {
    Function(path) {
      if (!FN_TYPES.has(path.node.type)) return;
      const score = complexityOf(path);
      functions.push({ name: functionName(path.node), line: path.node.loc.start.line, score, band: bandFor(score) });
    },
  });
  return { functions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/complexity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/complexity.js test/complexity.test.js
git commit -m "feat: per-function cyclomatic complexity"
```

---

## Task 7: Duplication detection

**Files:**
- Create: `src/analyzers/duplication.js`
- Test: `test/duplication.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/duplication.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { findDuplication } from '../src/analyzers/duplication.js';

const block = `function calc(a, b) {
  const x = a + b;
  const y = x * 2;
  const z = y - a;
  return z + b;
}`;

test('detects a duplicated block across two files and reports percentage', () => {
  const f1 = parseFile(block, 'a.js');
  const f2 = parseFile(block, 'b.js');
  const res = findDuplication([
    { file: 'a.js', content: block, tokens: f1.tokens },
    { file: 'b.js', content: block, tokens: f2.tokens },
  ], { minLines: 5 });
  assert.ok(res.percentage > 0);
  assert.equal(res.clusters.length >= 1, true);
  assert.equal(res.clusters[0].occurrences.length, 2);
});

test('no duplication on unique files', () => {
  const a = parseFile('const a = 1;\nconst b = 2;\n', 'a.js');
  const res = findDuplication([{ file: 'a.js', content: 'const a = 1;\nconst b = 2;\n', tokens: a.tokens }]);
  assert.equal(res.percentage, 0);
  assert.equal(res.clusters.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/duplication.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/analyzers/duplication.js
import crypto from 'node:crypto';

// Normalize identifiers/literals to type placeholders so renamed copies still match (near-dup).
function normToken(t) {
  const type = t.type?.label ?? t.type;
  if (type === 'name') return 'ID';
  if (type === 'num') return 'NUM';
  if (type === 'string' || type === 'template') return 'STR';
  return t.value ?? type;
}

export function normalizeLines(content, tokens) {
  const rawLines = content.split('\n');
  const byLine = new Map(); // line -> normalized token strings
  for (const t of tokens) {
    if (!t.loc || (t.type?.label ?? t.type) === 'eof') continue;
    const ln = t.loc.start.line;
    if (!byLine.has(ln)) byLine.set(ln, []);
    byLine.get(ln).push(normToken(t));
  }
  const out = [];
  for (const [n, toks] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({ n, norm: toks.join(' '), raw: (rawLines[n - 1] ?? '').trim() });
  }
  return out;
}

function hash(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

export function findDuplication(fileEntries, { minLines = 5 } = {}) {
  const windows = new Map(); // normHash -> [{ file, startLine, endLine, rawHash }]
  const perFileLines = [];
  let totalCodeLines = 0;

  for (const { file, content, tokens } of fileEntries) {
    const lines = normalizeLines(content, tokens);
    perFileLines.push({ file, lines });
    totalCodeLines += lines.length;
    for (let i = 0; i + minLines <= lines.length; i += 1) {
      const slice = lines.slice(i, i + minLines);
      const normHash = hash(slice.map((l) => l.norm).join('\n'));
      const rawHash = hash(slice.map((l) => l.raw).join('\n'));
      if (!windows.has(normHash)) windows.set(normHash, []);
      windows.get(normHash).push({ file, startLine: slice[0].n, endLine: slice[slice.length - 1].n, rawHash });
    }
  }

  const clusters = [];
  const dupLineKeys = new Set(); // `${file}:${line}`
  for (const occ of windows.values()) {
    if (occ.length < 2) continue;
    const kind = occ.every((o) => o.rawHash === occ[0].rawHash) ? 'exact' : 'near';
    clusters.push({
      lines: minLines,
      kind,
      occurrences: occ.map(({ file, startLine, endLine }) => ({ file, startLine, endLine })),
    });
    for (const o of occ) {
      for (let n = o.startLine; n <= o.endLine; n += 1) dupLineKeys.add(`${o.file}:${n}`);
    }
  }

  clusters.sort((a, b) => b.occurrences.length - a.occurrences.length);
  const percentage = totalCodeLines === 0 ? 0 : Number(((dupLineKeys.size / totalCodeLines) * 100).toFixed(2));
  return { percentage, clusters };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/duplication.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/duplication.js test/duplication.test.js
git commit -m "feat: near-duplicate block detection with percentage"
```

---

## Task 8: Secret scanning

**Files:**
- Create: `src/analyzers/secrets.js`
- Test: `test/secrets.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/secrets.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets } from '../src/analyzers/secrets.js';

test('flags an AWS-style key and redacts the excerpt', () => {
  const content = 'const k = "AKIAIOSFODNN7EXAMPLE";\n';
  const findings = scanSecrets(content, 'c.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].severity, 'high');
  assert.ok(!findings[0].excerpt.includes('AKIAIOSFODNN7EXAMPLE'));
});

test('flags a generic credential assignment', () => {
  const findings = scanSecrets('password = "hunter2supersecret"\n', 'c.js');
  assert.ok(findings.some((f) => f.rule === 'generic-credential'));
});

test('no false positive on plain code', () => {
  assert.equal(scanSecrets('const sum = a + b;\n', 'c.js').length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/secrets.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/analyzers/secrets.js
export const SECRET_RULES = [
  { name: 'aws-access-key', severity: 'high', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'private-key-block', severity: 'high', regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'generic-credential', severity: 'medium', regex: /(?:password|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

function redact(match) {
  if (match.length <= 6) return '*'.repeat(match.length);
  return `${match.slice(0, 3)}${'*'.repeat(match.length - 6)}${match.slice(-3)}`;
}

export function scanSecrets(content, filePath) {
  const findings = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    for (const rule of SECRET_RULES) {
      const m = line.match(rule.regex);
      if (m) {
        findings.push({
          file: filePath, line: i + 1, rule: rule.name, severity: rule.severity,
          excerpt: line.trim().replace(m[0], redact(m[0])).slice(0, 120),
        });
      }
    }
  });
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/secrets.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/secrets.js test/secrets.test.js
git commit -m "feat: regex secret scanning with redaction"
```

---

## Task 9: Quality scoring

**Files:**
- Create: `src/score.js`
- Test: `test/score.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/score.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/score.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/score.js
const SEVERITY_MULT = { high: 1.0, medium: 0.6, low: 0.3 };

function gradeFor(value) {
  if (value >= 90) return 'A';
  if (value >= 80) return 'B';
  if (value >= 70) return 'C';
  if (value >= 60) return 'D';
  return 'F';
}

export function scoreResult({ complexity, duplication, secrets }) {
  const secretsPenalty = -(secrets.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0));
  const complexityPenalty = -(complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0));
  const duplicationPenalty = -Math.min(25, duplication.percentage * 0.5);
  const breakdown = {
    secrets: Number(secretsPenalty.toFixed(2)),
    complexity: Number(complexityPenalty.toFixed(2)),
    duplication: Number(duplicationPenalty.toFixed(2)),
  };
  const raw = 100 + breakdown.secrets + breakdown.complexity + breakdown.duplication;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/score.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/score.js test/score.test.js
git commit -m "feat: weighted quality score and grade"
```

---

## Task 10: Scanner orchestration

**Files:**
- Create: `src/scanner.js`
- Test: `test/scanner.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/scanner.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/scanner.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'function f(a){ if(a){return 1;} return 2; }\n// c\n');
  fs.writeFileSync(path.join(dir, 'broken.ts'), 'function (\n');
  fs.writeFileSync(path.join(dir, 'readme.md'), '# hi\n');
  return dir;
}

test('produces a complete result object', () => {
  const dir = fixture();
  const r = scan(dir, { threshold: 10 });
  assert.equal(r.summary.totalFiles, 3);
  assert.ok(r.summary.functions >= 1);
  assert.equal(r.summary.byLanguage.JavaScript >= 1, true);
  assert.ok('value' in r.score);
  assert.ok(Array.isArray(r.complexity.flagged));
  assert.ok(r.skipped.some((s) => s.file.endsWith('broken.ts')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scanner.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/scanner.js
import fs from 'node:fs';
import { traverse } from './traverse.js';
import { detectLanguage, isJsTs } from './languages.js';
import { lineMetrics } from './metrics/lines.js';
import { parseFile, countDefinitions, commentLineNumbers } from './analyzers/ast.js';
import { fileComplexity } from './analyzers/complexity.js';
import { findDuplication } from './analyzers/duplication.js';
import { scanSecrets } from './analyzers/secrets.js';
import { scoreResult } from './score.js';

export function scan(rootDir, { threshold = 10, ignore = [] } = {}) {
  const start = Date.now();
  const files = traverse(rootDir, { ignore });

  const summary = { totalFiles: 0, byLanguage: {}, totalLines: 0, code: 0, comments: 0, blanks: 0, functions: 0, classes: 0 };
  const flagged = [];
  const allFnScores = [];
  const secretFindings = [];
  const dupEntries = [];
  const skipped = [];

  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); }
    catch (err) { skipped.push({ file, reason: `unreadable: ${err.code ?? err.message}` }); continue; }

    const language = detectLanguage(file) ?? 'Other';
    summary.totalFiles += 1;
    summary.byLanguage[language] = (summary.byLanguage[language] ?? 0) + 1;

    secretFindings.push(...scanSecrets(content, file));

    if (isJsTs(file)) {
      const parsed = parseFile(content, file);
      if (parsed.parseError) {
        skipped.push({ file, reason: `parseError: ${parsed.message}` });
        const m = lineMetrics(content);
        summary.totalLines += m.total; summary.code += m.code; summary.blanks += m.blanks;
        continue;
      }
      const commentLines = commentLineNumbers(parsed.comments);
      const m = lineMetrics(content, commentLines);
      summary.totalLines += m.total; summary.code += m.code; summary.comments += m.comments; summary.blanks += m.blanks;
      const defs = countDefinitions(parsed.ast);
      summary.functions += defs.functions; summary.classes += defs.classes;
      const { functions } = fileComplexity(parsed.ast);
      for (const fn of functions) {
        allFnScores.push(fn.score);
        if (fn.score > threshold) flagged.push({ file, line: fn.line, name: fn.name, score: fn.score, band: fn.band });
      }
      dupEntries.push({ file, content, tokens: parsed.tokens });
    } else {
      const m = lineMetrics(content);
      summary.totalLines += m.total; summary.code += m.code; summary.blanks += m.blanks;
    }
  }

  const duplication = findDuplication(dupEntries);
  const avg = allFnScores.length ? Number((allFnScores.reduce((a, b) => a + b, 0) / allFnScores.length).toFixed(2)) : 0;
  const max = allFnScores.length ? Math.max(...allFnScores) : 0;
  const complexity = { threshold, avg, max, flagged };
  const secrets = { findings: secretFindings };
  const score = scoreResult({ complexity, duplication, secrets });

  return {
    meta: { target: rootDir, scannedAt: new Date().toISOString(), durationMs: Date.now() - start },
    summary, complexity, duplication, secrets, score, skipped,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scanner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "feat: scanner pipeline orchestration"
```

---

## Task 11: JSON reporter

**Files:**
- Create: `src/report/json.js`
- Test: `test/report-json.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/report-json.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJson } from '../src/report/json.js';

test('serializes result to pretty JSON', () => {
  const out = toJson({ score: { value: 90, grade: 'A' } });
  assert.equal(JSON.parse(out).score.grade, 'A');
  assert.ok(out.includes('\n')); // pretty printed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/report-json.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/report/json.js
export function toJson(result) {
  return JSON.stringify(result, null, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/report-json.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/report/json.js test/report-json.test.js
git commit -m "feat: JSON reporter"
```

---

## Task 12: Markdown reporter

**Files:**
- Create: `src/report/markdown.js`
- Test: `test/report-markdown.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/report-markdown.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/report/markdown.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  duplication: { percentage: 5, clusters: [] },
  secrets: { findings: [] },
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3, duplication: -2.5 } },
  skipped: [],
};

test('renders headline score and feature sections', () => {
  const md = toMarkdown(result);
  assert.ok(md.includes('# Code Scan Report'));
  assert.ok(md.includes('88') && md.includes('Grade: B'));
  assert.ok(md.includes('Cyclomatic Complexity'));
  assert.ok(md.includes('Duplication'));
  assert.ok(md.includes('Secrets'));
  assert.ok(md.includes('| f |') || md.includes('`f`'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/report-markdown.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/report/markdown.js
function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return rows.length ? `${head}\n${body}` : '_none_';
}

export function toMarkdown(result) {
  const { meta, summary, complexity, duplication, secrets, score, skipped } = result;
  const langRows = Object.entries(summary.byLanguage).map(([k, v]) => [k, String(v)]);
  return `# Code Scan Report

**Target:** \`${meta.target}\`
**Scanned:** ${meta.scannedAt} (${meta.durationMs} ms)

## Score: ${score.value} / 100 — Grade: ${score.grade}

Penalties — secrets: ${score.breakdown.secrets}, complexity: ${score.breakdown.complexity}, duplication: ${score.breakdown.duplication}

## Summary

- Files: ${summary.totalFiles}
- Lines: ${summary.totalLines} (code ${summary.code}, comments ${summary.comments}, blanks ${summary.blanks})
- Functions: ${summary.functions}, Classes: ${summary.classes}

### Languages
${table(['Language', 'Files'], langRows)}

## Cyclomatic Complexity (threshold ${complexity.threshold}, avg ${complexity.avg}, max ${complexity.max})
${table(['Function', 'File', 'Line', 'Score', 'Band'], complexity.flagged.map((f) => [`\`${f.name}\``, f.file, String(f.line), String(f.score), f.band]))}

## Duplication: ${duplication.percentage}%
${table(['Kind', 'Lines', 'Occurrences'], duplication.clusters.map((c) => [c.kind, String(c.lines), String(c.occurrences.length)]))}

## Secrets
${table(['Rule', 'Severity', 'File', 'Line', 'Excerpt'], secrets.findings.map((s) => [s.rule, s.severity, s.file, String(s.line), s.excerpt]))}

## Skipped
${table(['File', 'Reason'], skipped.map((s) => [s.file, s.reason]))}
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/report-markdown.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/report/markdown.js test/report-markdown.test.js
git commit -m "feat: Markdown reporter"
```

---

## Task 13: HTML reporter with inline SVG

**Files:**
- Create: `src/report/html.js`
- Test: `test/report-html.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/report-html.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from '../src/report/html.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2, TypeScript: 1 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  duplication: { percentage: 5, clusters: [] },
  secrets: { findings: [] },
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3, duplication: -2.5 } },
  skipped: [],
};

test('produces self-contained HTML with inline SVG and no external script src', () => {
  const html = toHtml(result);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('88'));
  assert.ok(!html.includes('http://') && !html.includes('https://')); // no CDN
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/report-html.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/report/html.js
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function barChart(entries) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const rows = entries.map(([label, v], i) => {
    const w = Math.round((v / max) * 240);
    const y = i * 26;
    return `<text x="0" y="${y + 13}" font-size="12">${esc(label)}</text>` +
      `<rect x="110" y="${y}" width="${w}" height="18" fill="#4c8bf5"></rect>` +
      `<text x="${118 + w}" y="${y + 13}" font-size="12">${v}</text>`;
  }).join('');
  return `<svg width="400" height="${entries.length * 26 + 4}" role="img">${rows}</svg>`;
}

function gauge(value) {
  const color = value >= 80 ? '#2e9e54' : value >= 60 ? '#d9a300' : '#cc3333';
  return `<svg width="120" height="120"><circle cx="60" cy="60" r="50" fill="none" stroke="#eee" stroke-width="12"/>` +
    `<text x="60" y="66" text-anchor="middle" font-size="28" fill="${color}">${value}</text></svg>`;
}

function rows(headers, data) {
  if (!data.length) return '<p><em>none</em></p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function toHtml(result) {
  const { meta, summary, complexity, duplication, secrets, score } = result;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Code Scan Report</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#222}
table{border-collapse:collapse;margin:.5rem 0}th,td{border:1px solid #ddd;padding:4px 8px;font-size:13px;text-align:left}
.cards{display:flex;gap:2rem;align-items:center}section{margin:1.5rem 0}
</style></head><body>
<h1>Code Scan Report</h1>
<p><strong>Target:</strong> ${esc(meta.target)} — ${esc(meta.scannedAt)} (${meta.durationMs} ms)</p>
<div class="cards">
  <div><h2>Score</h2>${gauge(score.value)}<p>Grade ${esc(score.grade)}</p></div>
  <div><h2>Languages</h2>${barChart(Object.entries(summary.byLanguage))}</div>
</div>
<section><h2>Summary</h2>
<p>Files: ${summary.totalFiles} · Lines: ${summary.totalLines} (code ${summary.code}, comments ${summary.comments}, blanks ${summary.blanks}) · Functions: ${summary.functions} · Classes: ${summary.classes}</p></section>
<section><h2>Cyclomatic Complexity (threshold ${complexity.threshold})</h2>
${barChart(complexity.flagged.slice(0, 10).map((f) => [`${f.name} (${f.file})`, f.score]))}
${rows(['Function', 'File', 'Line', 'Score', 'Band'], complexity.flagged.map((f) => [f.name, f.file, f.line, f.score, f.band]))}</section>
<section><h2>Duplication: ${duplication.percentage}%</h2>
${rows(['Kind', 'Lines', 'Occurrences'], duplication.clusters.map((c) => [c.kind, c.lines, c.occurrences.length]))}</section>
<section><h2>Secrets</h2>
${rows(['Rule', 'Severity', 'File', 'Line', 'Excerpt'], secrets.findings.map((s) => [s.rule, s.severity, s.file, s.line, s.excerpt]))}</section>
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/report-html.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/report/html.js test/report-html.test.js
git commit -m "feat: self-contained HTML reporter with inline SVG"
```

---

## Task 14: CLI + public API

**Files:**
- Create: `src/cli.js`
- Create: `src/index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/cli.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, main } from '../src/cli.js';

test('parseArgs reads directory, formats, threshold', () => {
  const a = parseArgs(['/some/dir', '--format', 'json,md', '--threshold', '7', '--out', 'rep']);
  assert.equal(a.directory, '/some/dir');
  assert.deepEqual(a.formats, ['json', 'md']);
  assert.equal(a.threshold, 7);
  assert.equal(a.out, 'rep');
});

test('main scans a dir and writes reports, returns 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'function f(){ return 1; }\n');
  const out = path.join(dir, 'report');
  const code = await main([dir, '--out', out, '--format', 'json,md,html']);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(out, 'report.json')));
  assert.ok(fs.existsSync(path.join(out, 'report.md')));
  assert.ok(fs.existsSync(path.join(out, 'report.html')));
});

test('main returns 1 for a missing directory', async () => {
  const code = await main(['/no/such/dir/here']);
  assert.equal(code, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/index.js
export { scan } from './scanner.js';
export { toJson } from './report/json.js';
export { toMarkdown } from './report/markdown.js';
export { toHtml } from './report/html.js';
```

```javascript
// src/cli.js
import fs from 'node:fs';
import path from 'node:path';
import { scan } from './scanner.js';
import { toJson } from './report/json.js';
import { toMarkdown } from './report/markdown.js';
import { toHtml } from './report/html.js';

export function parseArgs(argv) {
  const args = { directory: null, out: 'scan-report', formats: ['json', 'md', 'html'], threshold: 10, ignore: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--format') args.formats = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--threshold') args.threshold = Number(argv[++i]);
    else if (a === '--ignore') args.ignore.push(argv[++i]);
    else if (a === '--help') args.help = true;
    else if (!a.startsWith('--') && args.directory === null) args.directory = a;
  }
  return args;
}

const HELP = `Usage: code-scanner <directory> [--out dir] [--format json,md,html] [--threshold n] [--ignore glob]`;

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return 0; }
  if (!args.directory) { console.error('Error: directory path is required\n' + HELP); return 1; }
  if (!fs.existsSync(args.directory) || !fs.statSync(args.directory).isDirectory()) {
    console.error(`Error: not a directory: ${args.directory}`); return 1;
  }

  const result = scan(args.directory, { threshold: args.threshold, ignore: args.ignore });
  fs.mkdirSync(args.out, { recursive: true });
  if (args.formats.includes('json')) fs.writeFileSync(path.join(args.out, 'report.json'), toJson(result));
  if (args.formats.includes('md')) fs.writeFileSync(path.join(args.out, 'report.md'), toMarkdown(result));
  if (args.formats.includes('html')) fs.writeFileSync(path.join(args.out, 'report.html'), toHtml(result));

  console.log(`Scanned ${result.summary.totalFiles} files — score ${result.score.value}/100 (${result.score.grade}). Reports in ${args.out}/`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.js src/index.js test/cli.test.js
git commit -m "feat: CLI entrypoint and public API"
```

---

## Task 15: Full suite + self-scan smoke test

**Files:**
- Modify: `README.md` (create)

- [ ] **Step 1: Run the whole test suite**

Run: `node --test`
Expected: all tests PASS, no failures.

- [ ] **Step 2: Run the scanner on itself**

Run: `node src/cli.js src --out scan-report`
Expected: prints a summary line; `scan-report/report.json`, `report.md`, `report.html` exist.

- [ ] **Step 3: Sanity-check the JSON output**

Run: `node -e "const r=require('node:fs').readFileSync('scan-report/report.json','utf8');const j=JSON.parse(r);console.log(j.summary.totalFiles, j.score.grade)"`
Expected: a file count > 0 and a grade letter.

- [ ] **Step 4: Write `README.md`**

```markdown
# code-scanner

A CLI that analyzes a JS/TS codebase and reports quality.

## Usage

\`\`\`bash
node src/cli.js <directory> [--out dir] [--format json,md,html] [--threshold 10]
\`\`\`

Outputs `report.json`, `report.md`, and `report.html` in the output directory.

## Features
- Basic metrics: files, lines (code/comments/blanks), functions, classes
- Cyclomatic complexity (flags functions over the threshold)
- Code duplication (near-duplicate detection + percentage)
- Secret scanning (redacted findings)
- Quality score (0–100 + letter grade)

See `RESEARCH.md` for architecture decisions.

## Development
\`\`\`bash
npm install
npm test
\`\`\`
```

- [ ] **Step 5: Commit**

```bash
git add README.md scan-report/.gitkeep 2>/dev/null; git add README.md
git commit -m "docs: README and self-scan verification"
```

---

## Self-Review Notes

- **Spec coverage:** CLI dir arg (T14), traversal+ignores (T3), language detection (T2), line metrics (T4), function/class counts (T5), 3 analyzers (T6–T8), JSON (T11) + Markdown (T12) + HTML/charts (T13), score+grade (T9), unit tests (every task), RESEARCH.md (already written). All spec sections mapped.
- **Type consistency:** function names match the locked Module Interfaces section (`scan`, `findDuplication`, `fileComplexity`, `scoreResult`, `toJson/toMarkdown/toHtml`, `parseArgs/main`).
- **Known approximation:** duplication reports fixed-size (minLines) windows rather than merging adjacent windows into maximal blocks — acceptable for v1; noted for future improvement.
