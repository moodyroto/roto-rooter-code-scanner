# Skip Test Files — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending written-spec review)
**Builds on:** the code-scanner + gitignore feature

## 1. Problem

Test files (unit tests, mocks) inflate and distort the quality report: their code
counts toward metrics, and test helpers/fixtures often duplicate each other or
production code. The scanner should exclude test files from analysis so the report
reflects production code quality.

## 2. Decision

Skip test files **by default**; add a `--include-tests` flag to scan them. Match by
filename convention and by test-directory convention.

| Decision | Choice |
|----------|--------|
| Default | Skip test files (exclude from traversal) |
| Opt-out flag | `--include-tests` |
| Filename patterns | `*.test.*` and `*.spec.*` for extensions js, jsx, ts, tsx, mjs, cjs, mts, cts |
| Directory patterns | any path segment named `__tests__` or `__mocks__` |
| NOT matched | `test/` and `tests/` directory names (too broad); `testUtils.ts`, `contest.ts`, etc. |
| Where applied | `traverse` (skipped files never enter the pipeline) |

## 3. Architecture

### New module: `src/test-files.js`
```javascript
const TEST_FILENAME = /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const TEST_DIRS = new Set(['__tests__', '__mocks__']);

export function isTestFile(relPath) {
  const parts = relPath.split(/[\\/]/);
  if (parts.some((p) => TEST_DIRS.has(p))) return true; // any segment is a test dir
  return TEST_FILENAME.test(parts[parts.length - 1]);    // filename infix
}
```
- `relPath` is a path relative to the scan root; both `/` and `\` separators are
  handled.
- Directory match returns true for any entry whose path contains a `__tests__` or
  `__mocks__` segment, so a directory entry itself is matched and pruned.

### `src/traverse.js`
- New option: `traverse(rootDir, { ignore = [], gitignore = true, includeTests = false })`.
- In the walk, after the existing gitignore check, add:
  `if (!includeTests && isTestFile(path.relative(rootDir, full))) continue;`
- Runs for both file and directory entries, so `__tests__/` / `__mocks__/`
  directories are pruned (whole subtree skipped) and `*.test.*` / `*.spec.*` files
  are skipped individually.
- `DEFAULT_IGNORE` and `BINARY_EXT` are unchanged and still applied.

### `src/scanner.js`
- `scan(rootDir, { threshold = 10, ignore = [], gitignore = true, includeTests = false })`.
- Passes `includeTests` through to `traverse`. Result-object shape unchanged.

### `src/cli.js`
- `parseArgs` defaults `includeTests: false` and recognizes `--include-tests`
  (valueless flag → `includeTests: true`).
- `main` passes `includeTests` into `scan`.
- HELP text adds `[--include-tests]`.

## 4. Data flow

```
cli.parseArgs(argv) -> { ..., includeTests }
  -> scan(dir, { threshold, ignore, gitignore, includeTests })
    -> traverse(dir, { ignore, gitignore, includeTests })
      -> walk: skip entry when DEFAULT_IGNORE / BINARY_EXT / gitignore
               / (!includeTests && isTestFile(relPath))
```

## 5. Reporter impact

None. Skipped test files never enter traversal, so they are absent from all counts
and metrics — the same way gitignored files behave. The `skipped` result field
remains reserved for unreadable / parse-error files, not policy exclusions.

## 6. Interaction notes

- This scanner's own tests are named `*.test.js` under `test/`, so by default they
  are excluded from its self-scan (test code no longer counts toward the score).
  `--include-tests` restores the previous behavior.
- Independent of `--no-gitignore`: a file is skipped if it is gitignored OR a test
  file (unless `--include-tests`).

## 7. Error handling

`isTestFile` is a pure predicate over a string; it cannot throw on normal input.
An empty or root path returns false (no segment matches, filename regex fails).

## 8. Testing

**`test/test-files.test.js`**
- True: `foo.test.ts`, `bar.spec.jsx`, `comp.test.tsx`, `m.spec.mjs`,
  `a/__tests__/b.ts`, `x/__mocks__/api.js`.
- False: `foo.ts`, `testUtils.ts`, `contest.ts`, `spec.ts`, `test/foo.ts`,
  `tests/foo.ts`, `a/__testsfoo__/b.ts`.

**`test/traverse.test.js` (extend)**
- Fixture: `a.js`, `a.test.js`, `__tests__/b.js`, `sub/c.spec.ts`, `sub/d.ts`.
  - Default: result includes `a.js` and `sub/d.ts`; excludes `a.test.js`,
    `__tests__/b.js`, `sub/c.spec.ts`.
  - `includeTests: true`: result includes all five.

**`test/cli.test.js` (extend)**
- `parseArgs(['/d']).includeTests === false`;
  `parseArgs(['/d', '--include-tests']).includeTests === true`.

## 9. Out of scope (YAGNI)

- Matching `.e2e.`, `.cy.` (Cypress), `.stories.` (Storybook), or `cypress/` dirs.
- Excluding `test/` / `tests/` directory names.
- Per-language test conventions beyond JS/TS (e.g. Python `test_*.py`).
- Configurable test-pattern list via CLI/file.
- Reporting which files were excluded as tests.
