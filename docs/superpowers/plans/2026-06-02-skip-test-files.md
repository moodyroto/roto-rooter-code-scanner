# Skip Test Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip unit-test files (by filename convention and `__tests__`/`__mocks__` directories) during scanning by default, with a `--include-tests` flag to scan them.

**Architecture:** A new `src/test-files.js` exposes `isTestFile(relPath)`. `traverse` consults it (gated by an `includeTests` option) and skips/prunes matches; `scan` and `cli` thread the boolean through, mirroring the existing `gitignore` option.

**Tech Stack:** Node v24, ESM, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-02-skip-test-files-design.md`

---

## Locked interfaces

```
src/test-files.js
  isTestFile(relPath) -> boolean   // *.test.* / *.spec.* (js,jsx,ts,tsx,mjs,cjs,mts,cts)
                                    // OR any path segment === __tests__ / __mocks__

src/traverse.js
  traverse(rootDir, { ignore = [], gitignore = true, includeTests = false }) -> string[]

src/scanner.js
  scan(rootDir, { threshold = 10, ignore = [], gitignore = true, includeTests = false }) -> ResultObject

src/cli.js
  parseArgs(argv) -> { directory, out, formats, threshold, ignore, gitignore, includeTests }
```

Default behavior: test files are skipped (`includeTests` defaults to `false`).

---

## Task 1: test-file predicate module

**Files:**
- Create: `src/test-files.js`
- Test: `test/test-files.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/test-files.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestFile } from '../src/test-files.js';

test('matches *.test.* and *.spec.* across JS/TS extensions', () => {
  for (const f of ['foo.test.ts', 'bar.spec.jsx', 'comp.test.tsx', 'm.spec.mjs', 'n.test.cjs', 'p.spec.cts']) {
    assert.equal(isTestFile(f), true, f);
  }
});

test('matches files inside __tests__ and __mocks__ directories', () => {
  assert.equal(isTestFile('a/__tests__/b.ts'), true);
  assert.equal(isTestFile('x/__mocks__/api.js'), true);
  assert.equal(isTestFile('a\\__tests__\\b.ts'), true); // windows separators
});

test('does not match production files or near-misses', () => {
  for (const f of ['foo.ts', 'testUtils.ts', 'contest.ts', 'spec.ts', 'test/foo.ts', 'tests/foo.ts', 'a/__testsfoo__/b.ts']) {
    assert.equal(isTestFile(f), false, f);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-files.test.js`
Expected: FAIL (cannot find module `../src/test-files.js`)

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/test-files.js
const TEST_FILENAME = /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const TEST_DIRS = new Set(['__tests__', '__mocks__']);

export function isTestFile(relPath) {
  const parts = String(relPath).split(/[\\/]/);
  if (parts.some((p) => TEST_DIRS.has(p))) return true; // any segment is a test dir
  return TEST_FILENAME.test(parts[parts.length - 1]);    // filename infix
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-files.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/test-files.js test/test-files.test.js
git commit -m "feat: isTestFile predicate for test-file conventions"
```

---

## Task 2: Wire into traversal

**Files:**
- Modify: `src/traverse.js`
- Test: `test/traverse.test.js` (extend — APPEND, keep existing tests)

- [ ] **Step 1: Append the failing test to `test/traverse.test.js`** (the file already imports `traverse`, `fs`, `os`, `path`, `assert`, `test`):

```javascript
test('skips test files by default and can include them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trav-test-'));
  fs.mkdirSync(path.join(dir, '__tests__'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.js'), '1');
  fs.writeFileSync(path.join(dir, 'a.test.js'), '1');
  fs.writeFileSync(path.join(dir, '__tests__', 'b.js'), '1');
  fs.writeFileSync(path.join(dir, 'sub', 'c.spec.ts'), '1');
  fs.writeFileSync(path.join(dir, 'sub', 'd.ts'), '1');

  const def = traverse(dir, {}).map((f) => path.relative(dir, f));
  assert.ok(def.includes('a.js'));
  assert.ok(def.includes(path.join('sub', 'd.ts')));
  assert.ok(!def.includes('a.test.js'));
  assert.ok(!def.some((f) => f.includes('__tests__')));
  assert.ok(!def.includes(path.join('sub', 'c.spec.ts')));

  const all = traverse(dir, { includeTests: true }).map((f) => path.relative(dir, f));
  assert.ok(all.includes('a.test.js'));
  assert.ok(all.includes(path.join('__tests__', 'b.js')));
  assert.ok(all.includes(path.join('sub', 'c.spec.ts')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/traverse.test.js`
Expected: FAIL (test files still returned by default — `a.test.js` present)

- [ ] **Step 3: Modify `src/traverse.js`**

(a) Add the import. The current import block is:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { loadGitignore, isIgnored } from './gitignore.js';
```

Append one line:

```javascript
import { isTestFile } from './test-files.js';
```

(b) Change the signature and the walk. The current function is:

```javascript
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

Replace it with (adds `includeTests` option and the test-file skip):

```javascript
export function traverse(rootDir, { ignore = [], gitignore = true, includeTests = false } = {}) {
  rootDir = path.resolve(rootDir);
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...ignore]);
  const matcher = gitignore ? loadGitignore(rootDir) : null;
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignoreSet.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full);
      if (isIgnored(matcher, rel)) continue;
      if (!includeTests && isTestFile(rel)) continue;
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
Expected: PASS (all traverse tests, including the new one). Then run `node --test` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/traverse.js test/traverse.test.js
git commit -m "feat: traverse skips test files unless includeTests"
```

---

## Task 3: Thread through the scanner

**Files:**
- Modify: `src/scanner.js:11-13`
- Test: `test/scanner.test.js` (extend — APPEND)

- [ ] **Step 1: Append the failing test to `test/scanner.test.js`** (the file already imports `scan`, `fs`, `os`, `path`, `assert`, `test`):

```javascript
test('scanner skips test files by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'a.test.js'), 'const t = 1;\n');

  const def = scan(dir);
  assert.equal(def.summary.byLanguage.JavaScript, 1); // only a.js

  const all = scan(dir, { includeTests: true });
  assert.equal(all.summary.byLanguage.JavaScript, 2); // a.js + a.test.js
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scanner.test.js`
Expected: FAIL (default scan counts 2 JavaScript files because `includeTests` is not threaded through)

- [ ] **Step 3: Modify `src/scanner.js`**

The current first lines of the `scan` function are:

```javascript
export function scan(rootDir, { threshold = 10, ignore = [], gitignore = true } = {}) {
  const start = Date.now();
  const files = traverse(rootDir, { ignore, gitignore });
```

Replace ONLY those with:

```javascript
export function scan(rootDir, { threshold = 10, ignore = [], gitignore = true, includeTests = false } = {}) {
  const start = Date.now();
  const files = traverse(rootDir, { ignore, gitignore, includeTests });
```

Do not change anything else.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scanner.test.js`
Expected: PASS. Then run `node --test` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "feat: thread includeTests option through scanner"
```

---

## Task 4: `--include-tests` CLI flag

**Files:**
- Modify: `src/cli.js`
- Test: `test/cli.test.js` (extend — APPEND)

- [ ] **Step 1: Append the failing test to `test/cli.test.js`** (the file already imports `parseArgs`, `main`, `fs`, `os`, `path`, `assert`, `test`):

```javascript
test('parseArgs defaults includeTests false and --include-tests enables it', () => {
  assert.equal(parseArgs(['/d']).includeTests, false);
  assert.equal(parseArgs(['/d', '--include-tests']).includeTests, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js`
Expected: FAIL (`includeTests` is undefined on the parsed args)

- [ ] **Step 3: Make three edits to `src/cli.js`**

(a) The `args` initializer line is currently:

```javascript
  const args = { directory: null, out: 'scan-report', formats: ['json', 'md', 'html'], threshold: 10, ignore: [], gitignore: true };
```

Change it to add `includeTests: false`:

```javascript
  const args = { directory: null, out: 'scan-report', formats: ['json', 'md', 'html'], threshold: 10, ignore: [], gitignore: true, includeTests: false };
```

(b) The `--no-gitignore` branch is currently:

```javascript
    else if (a === '--no-gitignore') args.gitignore = false;
    else if (a === '--help') args.help = true;
```

Insert an `--include-tests` branch between them:

```javascript
    else if (a === '--no-gitignore') args.gitignore = false;
    else if (a === '--include-tests') args.includeTests = true;
    else if (a === '--help') args.help = true;
```

(c) The HELP constant is currently:

```javascript
const HELP = `Usage: code-scanner <directory> [--out dir] [--format json,md,html] [--threshold n] [--ignore name] [--no-gitignore]`;
```

Change it to:

```javascript
const HELP = `Usage: code-scanner <directory> [--out dir] [--format json,md,html] [--threshold n] [--ignore name] [--no-gitignore] [--include-tests]`;
```

(d) The scan call is currently:

```javascript
  const result = scan(args.directory, { threshold: args.threshold, ignore: args.ignore, gitignore: args.gitignore });
```

Change it to pass `includeTests`:

```javascript
  const result = scan(args.directory, { threshold: args.threshold, ignore: args.ignore, gitignore: args.gitignore, includeTests: args.includeTests });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cli.test.js`
Expected: PASS. Then run `node --test` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "feat: --include-tests CLI flag"
```

---

## Task 5: Full suite + self-scan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: all tests PASS, no failures. If anything fails, STOP and report.

- [ ] **Step 2: Verify test files are excluded by default end-to-end**

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/src" "$TMP/src/__tests__"
printf 'export const a = 1;\n' > "$TMP/src/a.ts"
printf 'export const a = 1;\n' > "$TMP/src/a.test.ts"
printf 'export const b = 1;\n' > "$TMP/src/__tests__/b.ts"
echo "--- default (tests skipped) ---"
node src/cli.js "$TMP" --out "$TMP/r1" --format json >/dev/null
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/r1/report.json','utf8')); console.log('files', j.summary.totalFiles, '| TS', j.summary.byLanguage.TypeScript||0)"
echo "--- --include-tests ---"
node src/cli.js "$TMP" --out "$TMP/r2" --format json --include-tests >/dev/null
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/r2/report.json','utf8')); console.log('files', j.summary.totalFiles, '| TS', j.summary.byLanguage.TypeScript||0)"
rm -rf "$TMP"
```
Expected: default run counts only `a.ts` (1 TS file); `--include-tests` counts all three (`a.ts`, `a.test.ts`, `__tests__/b.ts`).

- [ ] **Step 3: No commit expected (verification only)**

```bash
git status --short
```

---

## Self-Review Notes

- **Spec coverage:** `isTestFile` predicate with filename + `__tests__`/`__mocks__` rules (T1), traverse skip + directory pruning + `includeTests` option (T2), scanner threading (T3), `--include-tests` flag default-skip (T4), end-to-end verification incl. the `__tests__/` dir case (T5). Reporter impact (none) and error handling (pure predicate) need no task.
- **Type consistency:** `isTestFile(relPath)` defined in T1, consumed in T2; `includeTests` option name consistent across traverse/scanner/cli; default `false` everywhere (skip by default).
- **Test design:** traverse fixture uses `a.test.js`, `__tests__/b.js`, `sub/c.spec.ts` (real conventions) and asserts both default-skip and `includeTests:true`; negative cases (`testUtils.ts`, `test/` dir) covered in T1's predicate tests.
