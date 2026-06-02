# P1 — Security Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the secrets feature with a unified `security` feature that detects hardcoded secrets (existing regex) plus dangerous function calls (new, AST-based), feeding one `security` result section, the score, and the reports.

**Architecture:** Rename `secrets.js` → `security.js`, add `scanDangerousCalls(ast, content, file)` (import-aware `child_process`, eval, new Function, vm.runIn*, string timers). Build the new module additively, then do one coordinated rename (`secrets` → `security`) across scanner/score/reporters, then delete the old module.

**Tech Stack:** Node v24, ESM, `@babel/traverse`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-02-security-scanning-design.md`

---

## Locked interfaces

```
src/analyzers/security.js
  SECRET_RULES
  scanSecrets(content, filePath) -> finding[]              // kind:'secret'
  scanDangerousCalls(ast, content, filePath) -> finding[]  // kind:'dangerous-call'

finding = { kind, rule, severity, file, line, excerpt }

src/scanner.js   result.security = { findings }   (replaces result.secrets)
src/score.js     scoreResult({ complexity, security }) -> { value, grade, breakdown:{ security, complexity } }
```

Dangerous-call rules: `eval` (high), `new-function` (high), `child-process-exec` (high), `vm-run` (high), `string-timer` (medium).

---

## Task 1: Create `security.js` (additive) with secrets + dangerous calls

**Files:**
- Create: `src/analyzers/security.js`
- Test: `test/security.test.js`

(`src/analyzers/secrets.js` is left in place for now; the scanner keeps using it until Task 2. The suite stays green with both modules present.)

- [ ] **Step 1: Write the failing test** at `test/security.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { scanSecrets, scanDangerousCalls } from '../src/analyzers/security.js';

function calls(src) {
  const { ast } = parseFile(src, 'x.js');
  return scanDangerousCalls(ast, src, 'x.js');
}
const rules = (src) => calls(src).map((f) => f.rule);

// --- secrets (existing behavior, now kind:'secret') ---
test('scanSecrets flags an AWS key, redacts it, and tags kind=secret', () => {
  const f = scanSecrets('const k = "AKIAIOSFODNN7EXAMPLE";\n', 'c.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'secret');
  assert.equal(f[0].severity, 'high');
  assert.ok(!f[0].excerpt.includes('AKIAIOSFODNN7EXAMPLE'));
});

test('scanSecrets still flags generic credential and OpenSSH key', () => {
  assert.ok(scanSecrets('password = "hunter2supersecret"\n', 'c.js').some((f) => f.rule === 'generic-credential'));
  assert.ok(scanSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\n', 'id').some((f) => f.rule === 'private-key-block'));
});

// --- dangerous calls: positives ---
test('flags eval', () => {
  const f = calls('eval(userInput);\n');
  assert.deepEqual(f.map((x) => [x.rule, x.severity, x.kind]), [['eval', 'high', 'dangerous-call']]);
});

test('flags new Function', () => {
  assert.deepEqual(rules('const g = new Function("return 1");\n'), ['new-function']);
});

test('flags child_process exec via namespace require', () => {
  assert.deepEqual(rules('const cp = require("child_process");\ncp.exec(cmd);\n'), ['child-process-exec']);
});

test('flags child_process execSync via named import', () => {
  assert.deepEqual(rules('import { execSync } from "child_process";\nexecSync(cmd);\n'), ['child-process-exec']);
});

test('flags vm.runInThisContext', () => {
  assert.deepEqual(rules('vm.runInThisContext(code);\n'), ['vm-run']);
});

test('flags setTimeout with a string body', () => {
  assert.deepEqual(rules('setTimeout("doThing()", 100);\n'), ['string-timer']);
});

// --- dangerous calls: negatives ---
test('does NOT flag RegExp.exec, function-arg timers, or non-cp execSync', () => {
  assert.deepEqual(rules('const m = re.exec(str);\n'), []);
  assert.deepEqual(rules('setTimeout(() => {}, 1000);\n'), []);
  assert.deepEqual(rules('obj.execSync(x);\n'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/security.test.js`
Expected: FAIL (cannot find module `../src/analyzers/security.js`)

- [ ] **Step 3: Write `src/analyzers/security.js`:**

```javascript
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;

export const SECRET_RULES = [
  { name: 'aws-access-key', severity: 'high', regex: /(AKIA[0-9A-Z]{16})/ },
  { name: 'private-key-block', severity: 'high', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'generic-credential', severity: 'medium', regex: /(?:password|secret|token|api[_-]?key)\s*[:=]\s*['"]([^'"]{8,})['"]/i },
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
        const sensitive = m[1] ?? m[0];
        findings.push({
          kind: 'secret', file: filePath, line: i + 1, rule: rule.name, severity: rule.severity,
          excerpt: line.trim().replaceAll(sensitive, redact(sensitive)).slice(0, 120),
        });
      }
    }
  });
  return findings;
}

const VM_METHODS = new Set(['runInThisContext', 'runInNewContext', 'runInContext']);
const TIMER_NAMES = new Set(['setTimeout', 'setInterval']);

function isStringArg(arg) {
  return !!arg && (arg.type === 'StringLiteral' || arg.type === 'TemplateLiteral');
}

export function scanDangerousCalls(ast, content, filePath) {
  const lines = content.split('\n');
  const namespaceBindings = new Set(); // names bound to the child_process module object
  const directBindings = new Set();    // names bound to child_process exec/execSync

  // Pass 1: collect child_process bindings so we only flag exec/execSync on them.
  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== 'child_process') return;
      for (const spec of path.node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
          namespaceBindings.add(spec.local.name);
        } else if (spec.type === 'ImportSpecifier' && (spec.imported.name === 'exec' || spec.imported.name === 'execSync')) {
          directBindings.add(spec.local.name);
        }
      }
    },
    VariableDeclarator(path) {
      const init = path.node.init;
      if (!init || init.type !== 'CallExpression') return;
      const callee = init.callee;
      const isRequireCP = callee.type === 'Identifier' && callee.name === 'require'
        && init.arguments[0]?.type === 'StringLiteral' && init.arguments[0].value === 'child_process';
      if (!isRequireCP) return;
      const id = path.node.id;
      if (id.type === 'Identifier') {
        namespaceBindings.add(id.name);
      } else if (id.type === 'ObjectPattern') {
        for (const prop of id.properties) {
          if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier'
              && (prop.key.name === 'exec' || prop.key.name === 'execSync')
              && prop.value.type === 'Identifier') {
            directBindings.add(prop.value.name);
          }
        }
      }
    },
  });

  const findings = [];
  const add = (node, rule, severity) => {
    if (!node.loc) return;
    const line = node.loc.start.line;
    findings.push({
      kind: 'dangerous-call', file: filePath, line, rule, severity,
      excerpt: (lines[line - 1] ?? '').trim().slice(0, 120),
    });
  };

  // Pass 2: flag dangerous nodes.
  traverse(ast, {
    NewExpression(path) {
      const c = path.node.callee;
      if (c.type === 'Identifier' && c.name === 'Function') add(path.node, 'new-function', 'high');
    },
    CallExpression(path) {
      const callee = path.node.callee;
      const args = path.node.arguments;
      if (callee.type === 'Identifier') {
        if (callee.name === 'eval') { add(path.node, 'eval', 'high'); return; }
        if (callee.name === 'Function') { add(path.node, 'new-function', 'high'); return; }
        if (directBindings.has(callee.name)) { add(path.node, 'child-process-exec', 'high'); return; }
        if (TIMER_NAMES.has(callee.name) && isStringArg(args[0])) { add(path.node, 'string-timer', 'medium'); return; }
      } else if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        const prop = callee.property.name;
        if (VM_METHODS.has(prop)) { add(path.node, 'vm-run', 'high'); return; }
        if ((prop === 'exec' || prop === 'execSync')
            && callee.object.type === 'Identifier' && namespaceBindings.has(callee.object.name)) {
          add(path.node, 'child-process-exec', 'high'); return;
        }
        if (TIMER_NAMES.has(prop) && isStringArg(args[0])) { add(path.node, 'string-timer', 'medium'); return; }
      }
    },
  });

  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/security.test.js`
Expected: PASS (all tests). Then run `node --test` — expect ALL PASS (old `secrets.js`/`secrets.test.js` still present and passing).

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/security.js test/security.test.js
git commit -m "feat: security analyzer (secrets + dangerous calls)"
```

---

## Task 2: Rewire scanner, score, and reporters to `security`

**Files:**
- Modify: `src/scanner.js`
- Modify: `src/score.js`
- Modify: `src/report/markdown.js`
- Modify: `src/report/html.js`
- Test: `test/score.test.js`, `test/scanner.test.js`, `test/report-markdown.test.js`, `test/report-html.test.js`

This is one coordinated rename so the live-render path never sees a missing key.

- [ ] **Step 1: Update the four test files**

(a) Replace `test/score.test.js` entirely with:
```javascript
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
```

(b) In `test/scanner.test.js`, in the `produces a complete result object` test, add these two lines just before its closing `});`:
```javascript
  assert.ok('security' in r, 'result has a security section');
  assert.ok(!('secrets' in r), 'secrets key replaced by security');
```

(c) In `test/report-markdown.test.js`:
- Top fixture: change `  secrets: { findings: [] },` to `  security: { findings: [] },` and `breakdown: { secrets: 0, complexity: -3 }` to `breakdown: { security: 0, complexity: -3 }`.
- In `renders headline score and feature sections`, change `assert.ok(md.includes('Secrets'));` to `assert.ok(md.includes('Security'));`.
- Pipe-escape test fixture: change `secrets: { findings: [{ rule: 'r', severity: 'high', file: 'a.js', line: 1, excerpt: 'a | b | c' }] },` to `security: { findings: [{ kind: 'secret', rule: 'r', severity: 'high', file: 'a.js', line: 1, excerpt: 'a | b | c' }] },` and `breakdown: { secrets: -50, complexity: 0 }` to `breakdown: { security: -50, complexity: 0 }`.

(d) In `test/report-html.test.js`:
- Top fixture: `secrets: { findings: [] },` → `security: { findings: [] },`; `breakdown: { secrets: 0, complexity: -3 }` → `breakdown: { security: 0, complexity: -3 }`.
- `renders a skipped section` fixture: `secrets: { findings: [] },` → `security: { findings: [] },`; `breakdown: { secrets: 0, complexity: 0 }` → `breakdown: { security: 0, complexity: 0 }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/score.test.js`
Expected: FAIL — old `score.js` reads `secrets`, so `security` is undefined and `security.findings` throws / value mismatches.

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

export function scoreResult({ complexity, security }) {
  const securityPenalty = -(security.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0));
  const complexityPenalty = -(complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0));
  const breakdown = {
    security: Number(securityPenalty.toFixed(2)),
    complexity: Number(complexityPenalty.toFixed(2)),
  };
  const raw = 100 + breakdown.security + breakdown.complexity;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
```

- [ ] **Step 4: Edit `src/scanner.js`**

(a) Change the secrets import line:
```javascript
import { scanSecrets } from './analyzers/secrets.js';
```
to:
```javascript
import { scanSecrets, scanDangerousCalls } from './analyzers/security.js';
```

(b) Rename the accumulator declaration `const secretFindings = [];` to:
```javascript
  const securityFindings = [];
```

(c) Change the all-files secret scan line `secretFindings.push(...scanSecrets(content, file));` to:
```javascript
    securityFindings.push(...scanSecrets(content, file));
```

(d) In the parsed JS/TS branch, immediately after the `for (const fn of functions) { ... }` loop (and before the closing `}` of the `if (isJsTs(file))` block), add:
```javascript
      securityFindings.push(...scanDangerousCalls(parsed.ast, content, file));
```

(e) Change `const secrets = { findings: secretFindings };` to:
```javascript
  const security = { findings: securityFindings };
```

(f) Change `const score = scoreResult({ complexity, secrets });` to:
```javascript
  const score = scoreResult({ complexity, security });
```

(g) In the returned object, change `summary, complexity, secrets, score, skipped,` to:
```javascript
    summary, complexity, security, score, skipped,
```

- [ ] **Step 5: Edit `src/report/markdown.js`**

(a) Destructure line: change `secrets` to `security`:
```javascript
  const { meta, summary, complexity, security, score, skipped } = result;
```

(b) Penalties line: change to read the renamed breakdown key:
```javascript
Penalties — security: ${score.breakdown.security}, complexity: ${score.breakdown.complexity}
```

(c) Replace the Secrets section:
```javascript
## Secrets
${table(['Rule', 'Severity', 'File', 'Line', 'Excerpt'], secrets.findings.map((s) => [s.rule, s.severity, s.file, String(s.line), s.excerpt]))}
```
with:
```javascript
## Security
${table(['Kind', 'Rule', 'Severity', 'File', 'Line', 'Excerpt'], security.findings.map((s) => [s.kind, s.rule, s.severity, s.file, String(s.line), s.excerpt]))}
```

- [ ] **Step 6: Edit `src/report/html.js`**

(a) Destructure line: change `secrets` to `security`:
```javascript
  const { meta, summary, complexity, security, score, skipped } = result;
```

(b) Replace the Secrets section:
```javascript
<section><h2>Secrets</h2>
${rows(['Rule', 'Severity', 'File', 'Line', 'Excerpt'], secrets.findings.map((s) => [s.rule, s.severity, s.file, s.line, s.excerpt]))}</section>
```
with:
```javascript
<section><h2>Security</h2>
${rows(['Kind', 'Rule', 'Severity', 'File', 'Line', 'Excerpt'], security.findings.map((s) => [s.kind, s.rule, s.severity, s.file, s.line, s.excerpt]))}</section>
```

- [ ] **Step 7: Run the full suite**

Run: `node --test`
Expected: ALL PASS (score, scanner, reporters now consistent on `security`).

- [ ] **Step 8: Commit**

```bash
git add src/scanner.js src/score.js src/report/markdown.js src/report/html.js test/score.test.js test/scanner.test.js test/report-markdown.test.js test/report-html.test.js
git commit -m "feat: unify secrets + dangerous calls into security section"
```

---

## Task 3: Delete old secrets module + verify end-to-end

**Files:**
- Delete: `src/analyzers/secrets.js`
- Delete: `test/secrets.test.js`

- [ ] **Step 1: Delete the old module and its test**

```bash
cd /Users/Rotolonm/Dev/tmp/code-scanner
git rm src/analyzers/secrets.js test/secrets.test.js
```

- [ ] **Step 2: Verify nothing imports the old module**

Run: `grep -rn "analyzers/secrets\|secretFindings\|\.secrets\b" src test`
Expected: no output. (`scanSecrets`/`SECRET_RULES` now live in `security.js`; those names may still appear, which is fine — only the old path/`secretFindings`/`.secrets` key must be gone.)

- [ ] **Step 3: Run the full suite**

Run: `node --test`
Expected: ALL PASS.

- [ ] **Step 4: End-to-end self-scan with a planted dangerous call + secret**

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/src"
printf 'const cp = require("child_process");\nexport function run(x) {\n  eval(x);\n  cp.execSync("ls");\n}\nconst key = "AKIAIOSFODNN7EXAMPLE";\n' > "$TMP/src/danger.js"
node src/cli.js "$TMP" --out "$TMP/r" --format json,md >/dev/null
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/r/report.json','utf8')); const fs2=j.security.findings; console.log('has security key:', 'security' in j, '| has secrets key:', 'secrets' in j); console.log('rules:', fs2.map(f=>f.kind+':'+f.rule).sort().join(', ')); console.log('score', j.score.value, j.score.grade, '| breakdown', Object.keys(j.score.breakdown).join(','))"
grep -c 'Security' "$TMP/r/report.md"
rm -rf "$TMP"
```
Expected: `has security key: true | has secrets key: false`; rules include `dangerous-call:child-process-exec`, `dangerous-call:eval`, and `secret:aws-access-key`; breakdown keys `security,complexity`; `grep -c 'Security'` ≥ 1.

- [ ] **Step 5: Commit**

```bash
git commit -am "chore: remove old secrets module (superseded by security)"
```

---

## Self-Review Notes

- **Spec coverage:** unified finding shape + `scanSecrets` kind tag + `scanDangerousCalls` rules incl. import-aware child_process and RegExp.exec negative (T1); `security` result key + dangerous-call wiring (T2 scanner); score rename (T2 score); Security section + Kind column (T2 reporters); old module deletion + e2e with both kinds (T3).
- **Type consistency:** finding `{ kind, rule, severity, file, line, excerpt }` produced in T1 and consumed by reporters in T2; `scoreResult({ complexity, security })` and `result.security` used consistently across T2.
- **Green at each task:** T1 is additive (old module still wired); T2 flips scanner+score+reporters together; T3 deletes only after the last importer is gone.
- **Placeholder scan:** all code shown in full; no TBDs.
