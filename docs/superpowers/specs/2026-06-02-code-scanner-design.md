# Code Scanner — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending written-spec review)

## 1. Purpose

A CLI tool that analyzes a JavaScript/TypeScript codebase and reports on its
quality. It traverses a directory, extracts basic metrics, runs three analysis
features (cyclomatic complexity, code duplication, secret scanning), computes a
0–100 quality score with a letter grade, and emits structured JSON plus
human-readable Markdown and HTML reports.

## 2. Scope decisions

| Decision | Choice |
|----------|--------|
| Runtime | Node v24, ESM (`"type": "module"`) |
| Parser | `@babel/parser` + `@babel/traverse` (JS/TS/JSX/TSX) |
| Analysis features | Cyclomatic complexity, Code duplication, Secret scan |
| Language scope | JS/TS AST-accurate; all files counted for language/line/secret coverage |
| Stretch goals in scope | Quality score + grade, unit tests, HTML report + charts, RESEARCH.md |
| Charts | Self-contained inline SVG (no CDN/network dependency) |
| Complexity threshold (default) | `> 10` flags a function |

### Coverage split

- **All files** — language detection by extension, file counts, raw line counts,
  and the **secret scan** (regex-based, language-agnostic).
- **JS/TS files only** — accurate code/comment/blank split (via parser tokens +
  comments), function & class counts, **cyclomatic complexity**, and
  **duplication** (token-based).

## 3. Architecture

Thin CLI over a `scan → analyze → report` pipeline. Each analyzer is an isolated
module with a well-defined input/output contract so it can be unit-tested alone.

```
CLI args → traverse(dir, ignores)
        → per file: detect language + line metrics
        → JS/TS files: parse to AST → functions, classes, complexity, token stream
        → cross-file: duplication (normalized token windows), secrets (regex, all files)
        → score (0–100 + grade)
        → reporters: JSON + Markdown + HTML
```

### Module layout

```
src/
  cli.js            # arg parsing + orchestration; process exit codes
  scanner.js        # pipeline orchestrator → builds the result object
  traverse.js       # recursive walk + ignore patterns
  languages.js      # extension → language map
  metrics/lines.js  # loc / comments / blanks
  analyzers/
    ast.js          # parse + count functions/classes; exposes AST + token stream
    complexity.js   # cyclomatic complexity per function
    duplication.js  # near-duplicate block detection + percentage
    secrets.js      # secret / API-key regex ruleset
  score.js          # weighted 0–100 + letter grade
  report/
    json.js
    markdown.js
    html.js
  index.js          # public entry (programmatic API)
test/               # node:test fixtures with known complexity / dupes / secrets
```

## 4. CLI

```
code-scanner <directory> [options]

Options:
  --out <dir>        Output directory for reports (default: ./scan-report)
  --format <list>    Comma list: json,md,html (default: json,md,html)
  --threshold <n>    Cyclomatic complexity flag threshold (default: 10)
  --ignore <glob>    Extra ignore pattern (repeatable)
  --help
```

- A directory path is required. Missing/invalid path → non-zero exit with a
  clear message.
- Default ignores: `node_modules`, `.git`, `dist`, `build`, `coverage`,
  `.cursor`, lockfiles, plus binary extensions.

## 5. Canonical result object

JSON is the source of truth; Markdown and HTML render from this object.

```jsonc
{
  "meta":       { "target", "scannedAt", "durationMs" },
  "summary":    { "totalFiles", "byLanguage", "totalLines",
                  "code", "comments", "blanks", "functions", "classes" },
  "complexity": { "threshold": 10, "avg", "max",
                  "flagged": [{ "file", "line", "name", "score", "band" }] },
  "duplication":{ "percentage",
                  "clusters": [{ "lines", "kind": "exact|near",
                                 "occurrences": [{ "file", "startLine", "endLine" }] }] },
  "secrets":    { "findings": [{ "file", "line", "rule", "severity", "excerpt" }] },
  "score":      { "value", "grade", "breakdown" },
  "skipped":    [{ "file", "reason" }]
}
```

## 6. Analyzer contracts

### 6.1 Cyclomatic complexity (`complexity.js`)
- Per function: start at 1, +1 for each `if`/`else if`, loop (`for`/`for..of`/
  `for..in`/`while`/`do..while`), `case`, `catch`, ternary, and logical
  `&&`/`||`/`??` used as a condition.
- Nested functions measured independently.
- Bands: `1–10` ok, `11–20` flag (refactor recommended), `21+` flag (high risk).
- Output: list of `{ file, line, name, score, band }` for functions over the
  threshold, plus `avg` and `max` across all functions.

### 6.2 Duplication (`duplication.js`)
- Normalize each JS/TS file's token stream: strip whitespace/comments, map
  identifier and literal names to placeholders.
- Slide a window of ≥ 5 non-blank/non-comment lines (~50 tokens); hash windows
  (rolling hash) and group equal hashes into clusters.
- `kind`: `exact` if raw text matches, else `near`.
- `percentage = duplicated lines / total JS-TS code lines * 100`, each line
  counted once.

### 6.3 Secrets (`secrets.js`)
- Regex ruleset over all text files: AWS keys, generic API keys, private key
  blocks, high-entropy assignments to `password|secret|token|apikey`.
- Output: `{ file, line, rule, severity, excerpt }`; excerpt redacts the match
  middle.

## 7. Scoring (`score.js`)

Start at 100; subtract weighted penalties, clamp to `[0,100]`:

- **Secrets** (heaviest): each finding scaled by severity.
- **Complexity**: penalty per flagged function, weighted by band.
- **Duplication**: penalty proportional to duplication percentage.

Grade map: `A ≥ 90`, `B ≥ 80`, `C ≥ 70`, `D ≥ 60`, else `F`. Exact weights and
rationale are documented in `RESEARCH.md` and surfaced in `score.breakdown`.

## 8. Reporters

- **JSON** — the canonical result object, pretty-printed.
- **Markdown** — summary table, score + grade, per-feature sections with the top
  findings, and a skipped-files note.
- **HTML** — self-contained single file with inline SVG charts: language
  breakdown (bar), score gauge, and top complexity offenders (bar). No network
  dependency.

## 9. Error handling

| Situation | Behavior |
|-----------|----------|
| Unreadable file | Record in `skipped` with reason; continue |
| Parse error (JS/TS) | Mark `parseError`; still count lines; skip AST findings |
| Invalid CLI path | Non-zero exit with message |
| Binary/non-text | Skipped by extension |

## 10. Testing

`node:test` with fixtures of known shape:
- A file with a function of known cyclomatic complexity → assert score & band.
- Two files sharing a duplicated block → assert cluster + percentage.
- A fixture with planted fake secrets → assert findings & redaction.
- Line metrics on a mixed code/comment/blank fixture.
- End-to-end: scan a fixture dir → assert result object shape and that all three
  reporters render without error.

## 11. Out of scope (YAGNI)

- Non-JS/TS AST analysis (Python, Go, etc.).
- Plugin/registry framework for analyzers.
- Network-fetched chart libraries.
- Auto-fixing or rewriting source.
