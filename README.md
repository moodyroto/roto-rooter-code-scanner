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
