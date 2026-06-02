# Gitignore-Aware Scan Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scanner skip files matched by the target's root `.gitignore` (on by default, `--no-gitignore` to disable), so compiled output is excluded from analysis.

**Architecture:** A new `src/gitignore.js` loads the root `.gitignore` into an `ignore`-package matcher. `traverse` consults it during the walk and prunes matches; `scan` and `cli` thread a `gitignore` boolean through. `DEFAULT_IGNORE` stays as a baseline.

**Tech Stack:** Node v24, ESM, `ignore` npm package, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-02-gitignore-scope-design.md`

---

## Locked interfaces

```
src/gitignore.js
  loadGitignore(rootDir) -> matcher | null   // reads <rootDir>/.gitignore
  isIgnored(matcher, relPath) -> boolean      // false when matcher is null

src/traverse.js
  traverse(rootDir, { ignore = [], gitignore = true }) -> string[]

src/scanner.js
  scan(rootDir, { threshold = 10, ignore = [], gitignore = true }) -> ResultObject

src/cli.js
  parseArgs(argv) -> { directory, out, formats, threshold, ignore, gitignore }
```

---

## Task 1: Add the `ignore` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
cd /Users/Rotolonm/Dev/tmp/code-scanner
npm install ignore
```

- [ ] **Step 2: Verify it imports**

Run: `node --input-type=module -e "import ig from 'ignore'; console.log(typeof ig().add('x').ignores)"`
Expected: prints `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ignore dependency for gitignore matching"
```

---

## Task 2: gitignore module

**Files:**
- Create: `src/gitignore.js`
- Test: `test/gitignore.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/gitignore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGitignore, isIgnored } from '../src/gitignore.js';

function tmp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-'));
  if (contents !== null) fs.writeFileSync(path.join(dir, '.gitignore'), contents);
  return dir;
}

test('loadGitignore returns null when no .gitignore exists', () => {
  assert.equal(loadGitignore(tmp(null)), null);
});

test('isIgnored honors patterns and negation', () => {
  const m = loadGitignore(tmp('generated/\n*.log\n!keep.log\n'));
  assert.equal(isIgnored(m, 'generated/x.js'), true);
  assert.equal(isIgnored(m, 'debug.log'), true);
  assert.equal(isIgnored(m, 'keep.log'), false);
  assert.equal(isIgnored(m, 'a.js'), false);
});

test('isIgnored returns false for a null matcher and for the root', () => {
  assert.equal(isIgnored(null, 'anything.js'), false);
  const m = loadGitignore(tmp('*.log\n'));
  assert.equal(isIgnored(m, ''), false);
  assert.equal(isIgnored(m, '.'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gitignore.test.js`
Expected: FAIL (cannot find module `../src/gitignore.js`)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/gitignore.js
import fs from 'node:fs';
import path from 'node:path';
import makeIgnore from 'ignore';

export function loadGitignore(rootDir) {
  const file = path.join(rootDir, '.gitignore');
  let content;
  try { content = fs.readFileSync(file, 'utf8'); }
  catch { return null; }
  return makeIgnore().add(content);
}

export function isIgnored(matcher, relPath) {
  if (!matcher) return false;
  const posix = relPath.split(path.sep).join('/');
  if (posix === '' || posix === '.') return false;
  return matcher.ignores(posix);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gitignore.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/gitignore.js test/gitignore.test.js
git commit -m "feat: gitignore matcher (loadGitignore, isIgnored)"
```

---

## Task 3: Wire gitignore into traversal

**Files:**
- Modify: `src/traverse.js`
- Test: `test/traverse.test.js` (extend)

- [ ] **Step 1: Write the failing test (append to `test/traverse.test.js`)**

```javascript
test('respects root .gitignore by default and can be disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trav-gi-'));
  fs.mkdirSync(path.join(dir, 'generated'));
  fs.writeFileSync(path.join(dir, 'a.js'), '1');
  fs.writeFileSync(path.join(dir, 'generated', 'x.js'), '1');
  fs.writeFileSync(path.join(dir, 'debug.log'), '1');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'generated/\n*.log\n');

  const on = traverse(dir, {}).map((f) => path.relative(dir, f));
  assert.ok(on.includes('a.js'));
  assert.ok(!on.some((f) => f.startsWith('generated')));
  assert.ok(!on.includes('debug.log'));

  const off = traverse(dir, { gitignore: false }).map((f) => path.relative(dir, f));
  assert.ok(off.includes(path.join('generated', 'x.js')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/traverse.test.js`
Expected: FAIL (gitignored files still returned — `generated/x.js` present when it should be excluded)

- [ ] **Step 3: Modify `src/traverse.js`**

Replace the entire file with:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { loadGitignore, isIgnored } from './gitignore.js';

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.cursor', 'scan-report',
]);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.lock', '.woff', '.woff2']);

export function traverse(rootDir, { ignore = [], gitignore = true } = {}) {
  rootDir = path.resolve(rootDir);
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...ignore]);
  const matcher = gitignore ? loadGitignore(rootDir) : null;
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignoreSet.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (isIgnored(matcher, path.relative(rootDir, full))) continue;
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
Expected: PASS (all traverse tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/traverse.js test/traverse.test.js
git commit -m "feat: traverse respects root .gitignore (gitignore option)"
```

---

## Task 4: Thread gitignore through the scanner

**Files:**
- Modify: `src/scanner.js:11-13`
- Test: `test/scanner.test.js` (extend)

- [ ] **Step 1: Write the failing test (append to `test/scanner.test.js`)**

```javascript
test('scanner skips gitignored files by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-gi-'));
  fs.mkdirSync(path.join(dir, 'generated'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'generated', 'x.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'generated/\n');

  const on = scan(dir);
  assert.equal(on.summary.byLanguage.JavaScript, 1); // only a.js

  const off = scan(dir, { gitignore: false });
  assert.equal(off.summary.byLanguage.JavaScript, 2); // a.js + generated/x.js
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scanner.test.js`
Expected: FAIL (default scan counts 2 JavaScript files because gitignore is not threaded through)

- [ ] **Step 3: Modify `src/scanner.js`**

Change the signature and the `traverse` call (lines 11 and 13). The current lines are:

```javascript
export function scan(rootDir, { threshold = 10, ignore = [] } = {}) {
  const start = Date.now();
  const files = traverse(rootDir, { ignore });
```

Replace them with:

```javascript
export function scan(rootDir, { threshold = 10, ignore = [], gitignore = true } = {}) {
  const start = Date.now();
  const files = traverse(rootDir, { ignore, gitignore });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scanner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "feat: thread gitignore option through scanner"
```

---

## Task 5: `--no-gitignore` CLI flag

**Files:**
- Modify: `src/cli.js` (parseArgs defaults + flag handling, HELP text, scan call)
- Test: `test/cli.test.js` (extend)

- [ ] **Step 1: Write the failing test (append to `test/cli.test.js`)**

```javascript
test('parseArgs defaults gitignore true and --no-gitignore disables it', () => {
  assert.equal(parseArgs(['/d']).gitignore, true);
  assert.equal(parseArgs(['/d', '--no-gitignore']).gitignore, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js`
Expected: FAIL (`gitignore` is undefined on the parsed args)

- [ ] **Step 3: Modify `src/cli.js`**

(a) Add the default. Change the `args` initializer line (currently):

```javascript
  const args = { directory: null, out: 'scan-report', formats: ['json', 'md', 'html'], threshold: 10, ignore: [] };
```

to:

```javascript
  const args = { directory: null, out: 'scan-report', formats: ['json', 'md', 'html'], threshold: 10, ignore: [], gitignore: true };
```

(b) Handle the flag. After the `--ignore` branch and before `else if (a === '--help')`, add a new branch:

```javascript
    else if (a === '--no-gitignore') args.gitignore = false;
```

(c) Update the HELP text constant to mention the flag:

```javascript
const HELP = `Usage: code-scanner <directory> [--out dir] [--format json,md,html] [--threshold n] [--ignore name] [--no-gitignore]`;
```

(d) Pass it to scan. Change the scan call (currently):

```javascript
  const result = scan(args.directory, { threshold: args.threshold, ignore: args.ignore });
```

to:

```javascript
  const result = scan(args.directory, { threshold: args.threshold, ignore: args.ignore, gitignore: args.gitignore });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "feat: --no-gitignore CLI flag"
```

---

## Task 6: Full suite + self-scan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: all tests PASS, no failures. If anything fails, STOP and report.

- [ ] **Step 2: Verify gitignore prunes a real build dir end-to-end**

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/src" "$TMP/out"
printf 'export const a = 1;\n' > "$TMP/src/a.ts"
printf 'export const a = 1;\n' > "$TMP/out/a.js"
printf 'out/\n' > "$TMP/.gitignore"
node src/cli.js "$TMP" --out "$TMP/report" --format json
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/report/report.json','utf8')); console.log('files', j.summary.totalFiles, 'dupPct', j.duplication.percentage)"
```
Expected: `out/a.js` is excluded — `files` counts the source side but not the gitignored `out/` copy, and duplication is not inflated by the compiled mirror. (Re-running with `--no-gitignore` would include `out/a.js`.)

- [ ] **Step 3: Confirm `--no-gitignore` includes the build dir**

```bash
node src/cli.js "$TMP" --out "$TMP/report2" --format json --no-gitignore
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/report2/report.json','utf8')); console.log('files', j.summary.totalFiles)"
```
Expected: `files` is higher than in Step 2 (now includes `out/a.js`).

- [ ] **Step 4: Commit (nothing to commit expected; skip if clean)**

```bash
git status --short
```

---

## Self-Review Notes

- **Spec coverage:** `src/gitignore.js` (T2), traverse integration + directory pruning (T3), scanner threading (T4), `--no-gitignore` default-on flag (T5), `ignore` dependency (T1), end-to-end verification incl. the TS-compile case (T6). Error handling (missing/unreadable `.gitignore` → null) covered by T2 tests.
- **Test design:** fixtures use `generated/` and `out/` (NOT in `DEFAULT_IGNORE`) so the assertions genuinely exercise gitignore rather than the baseline ignore list.
- **Type consistency:** `loadGitignore`/`isIgnored` signatures match across T2–T3; `gitignore` option name consistent across traverse/scanner/cli; matcher is `null` (not undefined) when absent.
