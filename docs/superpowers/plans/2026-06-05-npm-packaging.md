# `@ma/roto-rooter` Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repo into a publishable, scoped npm package (`@ma/roto-rooter`) distributed manually via JFrog Artifactory, with a `roto-rooter` CLI command.

**Architecture:** Pure packaging/config work — no source-code logic changes. Update `package.json` metadata, add a committed `.npmrc` that routes the `@ma` scope to Artifactory (token via env var only), add an ISC `LICENSE`, update the `README`, and verify the published tarball contents with `npm pack`/`npm publish --dry-run`.

**Tech Stack:** Node 24, npm, ESM. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-05-npm-packaging-design.md`

**Placeholders:** `<artifactory-host>` and `<npm-repo>` are intentional — a maintainer replaces them with real Artifactory values before the first publish. Do not invent real values.

---

### Task 1: Rewrite `package.json` metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace the full contents of `package.json`**

Write `package.json` to exactly this (preserves existing deps and scripts, adds packaging fields):

```json
{
  "name": "@ma/roto-rooter",
  "version": "1.0.0",
  "description": "A CLI that analyzes a JS/TS codebase and reports on its quality.",
  "type": "module",
  "main": "src/index.js",
  "bin": {
    "roto-rooter": "src/cli.js"
  },
  "files": [
    "src",
    "RESEARCH.md"
  ],
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "test": "node --test",
    "scan": "node src/cli.js",
    "prepublishOnly": "npm test"
  },
  "keywords": [
    "code-quality",
    "static-analysis",
    "cli",
    "scanner",
    "metrics"
  ],
  "author": "Michael Rotoloni",
  "license": "ISC",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/moodyroto/roto-rooter-code-scanner.git"
  },
  "bugs": {
    "url": "https://github.com/moodyroto/roto-rooter-code-scanner/issues"
  },
  "homepage": "https://github.com/moodyroto/roto-rooter-code-scanner#readme",
  "publishConfig": {
    "@ma:registry": "https://<artifactory-host>/artifactory/api/npm/<npm-repo>/"
  },
  "dependencies": {
    "@babel/parser": "^7.29.7",
    "@babel/traverse": "^7.29.7",
    "ignore": "^7.0.5"
  }
}
```

- [ ] **Step 2: Validate JSON and confirm key fields**

Run: `node -e "const p=require('./package.json'); console.log(p.name, '|', Object.keys(p.bin)[0], '|', p.engines.node, '|', p.files.join(','))"`
Expected: `@ma/roto-rooter | roto-rooter | >=24 | src,RESEARCH.md`

- [ ] **Step 3: Confirm tests still pass after the edit**

Run: `npm test`
Expected: all tests pass (same as before the edit).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: scope package as @ma/roto-rooter with publish metadata"
```

---

### Task 2: Add committed `.npmrc` routing the scope to Artifactory

**Files:**
- Create: `.npmrc`

- [ ] **Step 1: Create `.npmrc` at the repo root**

```
@ma:registry=https://<artifactory-host>/artifactory/api/npm/<npm-repo>/
//<artifactory-host>/artifactory/api/npm/<npm-repo>/:_authToken=${NPM_AUTH_TOKEN}
```

- [ ] **Step 2: Verify the token is sourced from an env var, not hard-coded**

Run: `grep -c 'NPM_AUTH_TOKEN}' .npmrc`
Expected: `1` (the auth line uses the `${NPM_AUTH_TOKEN}` placeholder; no literal token present).

- [ ] **Step 3: Commit**

```bash
git add .npmrc
git commit -m "build: route @ma scope to Artifactory via .npmrc (token from env)"
```

---

### Task 3: Add the `LICENSE` file

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create `LICENSE` with ISC text**

```
ISC License

Copyright (c) 2026 Michael Rotoloni

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add ISC LICENSE"
```

---

### Task 4: Update `README.md` for install, usage, and release flow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the full contents of `README.md`**

```markdown
# @ma/roto-rooter

A CLI that analyzes a JS/TS codebase and reports on its quality.

## Installation

This package is published to a private JFrog Artifactory registry under the `@ma`
scope. Point the scope at your Artifactory npm repo (one-time, in your user `~/.npmrc`):

```bash
npm config set @ma:registry https://<artifactory-host>/artifactory/api/npm/<npm-repo>/
```

Then install globally:

```bash
npm install -g @ma/roto-rooter
```

## Usage

```bash
roto-rooter <directory> [--out dir] [--format json,md,html] [--threshold 10]
```

Outputs `report.json`, `report.md`, and `report.html` in the output directory
(default `scan-report/`).

### Options
- `--out <dir>` — output directory (default `scan-report`)
- `--format <list>` — comma list of `json,md,html` (default all)
- `--threshold <n>` — cyclomatic complexity flag threshold (default 10)
- `--ignore <name>` — extra directory/file name to ignore (repeatable)
- `--no-gitignore` — do not honor `.gitignore` patterns
- `--include-tests` — include test files in the scan

## Features
- Basic metrics: files, lines (code/comments/blanks), functions, classes
- Cyclomatic complexity (flags functions over the threshold)
- Secret scanning (redacted findings)
- Quality score (0–100 + letter grade)

See `RESEARCH.md` for architecture decisions.

## Development

```bash
npm install
npm test
```

## Releasing (manual publish to Artifactory)

1. Replace the `<artifactory-host>` / `<npm-repo>` placeholders in `.npmrc` and
   `package.json` (`publishConfig`) with real Artifactory values (one-time).
2. Export an Artifactory auth token (never commit it):
   ```bash
   export NPM_AUTH_TOKEN=<token>
   ```
3. Bump the `version` in `package.json`.
4. Preview the tarball contents:
   ```bash
   npm publish --dry-run
   ```
5. Publish (`prepublishOnly` runs the test suite first and aborts on failure):
   ```bash
   npm publish
   ```
6. Tag the release for traceability:
   ```bash
   git tag v$(node -p "require('./package.json').version") && git push --tags
   ```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document install, roto-rooter usage, and manual release flow"
```

---

### Task 5: Verify the published tarball contents

**Files:** none (verification only)

- [ ] **Step 1: List exactly what would be published**

Run: `npm pack --dry-run 2>&1`
Expected: the `Tarball Contents` listing includes `package.json`, `README.md`, `LICENSE`, `RESEARCH.md`, and files under `src/` (e.g. `src/cli.js`, `src/index.js`, `src/scanner.js`, and the `src/analyzers`, `src/metrics`, `src/report` trees).

- [ ] **Step 2: Confirm excluded paths are NOT in the tarball**

Run: `npm pack --dry-run 2>&1 | grep -E 'test/|scan-report/|docs/|node_modules/|\.superpowers|\.cursor|\.claude|package-lock' || echo "CLEAN"`
Expected: `CLEAN` (none of those paths appear in the tarball).

- [ ] **Step 3: Confirm the package name and bin resolve**

Run: `npm pack --dry-run 2>&1 | grep -E 'name:|filename:'`
Expected: package filename is `ma-roto-rooter-1.0.0.tgz`.

- [ ] **Step 4: Final full test run**

Run: `npm test`
Expected: all tests pass.

---

## Notes for the implementer

- Do NOT run `npm publish` (without `--dry-run`) — publishing is the maintainer's manual step and requires real Artifactory credentials.
- Do NOT replace the `<artifactory-host>` / `<npm-repo>` placeholders with guessed values.
- No source files under `src/` change; if a test fails, the cause is almost certainly the `package.json` edit (e.g. a JSON typo), not the analyzers.
