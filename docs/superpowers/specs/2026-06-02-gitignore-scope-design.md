# Gitignore-Aware Scan Scope — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending written-spec review)
**Builds on:** the code-scanner (`docs/superpowers/specs/2026-06-02-code-scanner-design.md`)

## 1. Problem

Compiled output (e.g. TypeScript transpiled to JavaScript in `dist/`, `build/`,
`out/`, `lib/`) duplicates the original source. The duplication analyzer then
reports false positives where compiled `.js` mirrors the authoring `.ts`. We want
the scanner to skip generated/ignored files so analysis reflects real source.

## 2. Decision

Make traversal **respect the target's root `.gitignore`**, **on by default**, with
a `--no-gitignore` opt-out. Build artifacts are normally gitignored, so this prunes
them generically — without hard-coding `src/` and without breaking the "scan any
codebase" goal.

| Decision | Choice |
|----------|--------|
| Mechanism | Respect `.gitignore` (no `src/` hard-coding, no `--include`) |
| Default | On; disable with `--no-gitignore` |
| Matcher | `ignore` npm package (correct gitignore semantics) |
| Scope (v1) | Root-level `<target>/.gitignore` only; nested `.gitignore` deferred |
| Baseline ignores | `DEFAULT_IGNORE` retained as a safety net |

## 3. Architecture

### New module: `src/gitignore.js`
- `loadGitignore(rootDir) -> matcher | null`
  - Reads `<rootDir>/.gitignore`. If absent/unreadable, returns `null`.
  - Returns an `ignore()` matcher loaded with the file's patterns.
- `isIgnored(matcher, relPath) -> boolean`
  - Returns `false` when `matcher` is `null`.
  - Normalizes `relPath` to POSIX separators and returns `matcher.ignores(relPath)`.
  - Empty string / `.` returns `false` (never ignore the root itself).

The npm package is imported aliased to avoid colliding with the existing `ignore`
option name: `import makeIgnore from 'ignore'`.

### `src/traverse.js` changes
- Signature: `traverse(rootDir, { ignore = [], gitignore = true }) -> string[]`.
- When `gitignore` is true, call `loadGitignore(rootDir)` once before walking.
- During the walk, for each entry compute `relPath = path.relative(rootDir, full)`
  and skip the entry when `isIgnored(matcher, relPath)` is true.
- A matched **directory** is pruned (not descended) — this is what makes `dist/`
  cheap and correct.
- `DEFAULT_IGNORE` (node_modules, `.git`, dist, build, coverage, .cursor,
  scan-report) and `BINARY_EXT` are unchanged and still applied first. `.git` is
  always skipped regardless of gitignore.

### `src/scanner.js` changes
- Signature: `scan(rootDir, { threshold = 10, ignore = [], gitignore = true })`.
- Passes `{ ignore, gitignore }` through to `traverse`.
- No change to the result object shape.

### `src/cli.js` changes
- `parseArgs` gains `gitignore: true` in defaults and recognizes `--no-gitignore`
  (sets `gitignore: false`). It is a boolean flag and takes no value.
- `main` passes `gitignore` into `scan`.
- Help text adds: `--no-gitignore  Do not skip files matched by .gitignore`.

## 4. Data flow

```
cli.parseArgs(argv) -> { ..., gitignore }
  -> scan(dir, { threshold, ignore, gitignore })
    -> traverse(dir, { ignore, gitignore })
      -> matcher = gitignore ? loadGitignore(dir) : null
      -> walk: skip entry when DEFAULT_IGNORE / BINARY_EXT / isIgnored(matcher, relPath)
```

## 5. Matching semantics (via `ignore` package)

- Patterns matched against root-relative POSIX paths.
- Supported (by the package): negation (`!keep.log`), directory-only (`dist/`),
  anchored (`/foo`), wildcards and `**`.
- Directory pruning: when a directory's relative path is ignored, its subtree is
  not traversed.

## 6. Error handling

| Situation | Behavior |
|-----------|----------|
| No `.gitignore` at root | `loadGitignore` returns `null`; traversal behaves as before |
| `.gitignore` unreadable | Treated as absent (`null`); scan continues |
| `--no-gitignore` passed | Matcher is never loaded; only DEFAULT_IGNORE/BINARY_EXT apply |

## 7. Testing

> **Test-design note:** fixtures use `generated/` (a directory NOT in
> `DEFAULT_IGNORE`) rather than `dist/`. Since `dist` is already default-ignored,
> a `dist/`-based test would pass even if gitignore did nothing. Using
> `generated/` ensures the assertions actually exercise the gitignore matcher.

**`test/gitignore.test.js`**
- `loadGitignore` returns `null` when no `.gitignore` exists.
- With a `.gitignore` containing `generated/`, `*.log`, `!keep.log`:
  - `isIgnored` true for `generated/x.js` and `debug.log`.
  - `isIgnored` false for `a.js` and for `keep.log` (negation honored).
  - `isIgnored` false when matcher is `null`.

**`test/traverse.test.js` (extend)**
- Fixture with `.gitignore` (`generated/`, `*.log`), files `a.js`,
  `generated/x.js`, `debug.log`:
  - Default (`gitignore` on): result includes `a.js`, excludes `generated/x.js`
    and `debug.log`.
  - `gitignore: false`: result includes `generated/x.js` again.

**`test/cli.test.js` (extend)**
- `parseArgs(['/d', '--no-gitignore'])` yields `gitignore === false`.

## 8. Out of scope (YAGNI)

- Nested per-directory `.gitignore` files.
- Global gitignore / git excludes / `.git/info/exclude`.
- `--include` path restriction or `src/` defaulting.
- Reading `.gitignore` of parent directories above the scan root.
