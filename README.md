# code-scanner

A CLI that analyzes a JS/TS codebase and reports quality.

## Usage

```bash
node src/cli.js <directory> [--out dir] [--format json,md,html] [--threshold 10]
```

Outputs `report.json`, `report.md`, and `report.html` in the output directory (default `scan-report/`).

### Options
- `--out <dir>` — output directory (default `scan-report`)
- `--format <list>` — comma list of `json,md,html` (default all)
- `--threshold <n>` — cyclomatic complexity flag threshold (default 10)
- `--ignore <name>` — extra directory/file name to ignore (repeatable)

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
