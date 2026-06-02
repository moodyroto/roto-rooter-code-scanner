# RESEARCH.md — Architecture & Decisions

This document records the architectural decisions behind the code scanner and the
reasoning that produced them. The full design spec lives at
`docs/superpowers/specs/2026-06-02-code-scanner-design.md`.

## Goal

A CLI that analyzes a JS/TS codebase and reports its quality: basic metrics,
three analysis features, a 0–100 quality score, and JSON/Markdown/HTML reports.

## Key decisions

### 1. Language scope: JS/TS, AST-accurate

We chose accurate AST analysis for JavaScript/TypeScript over a broad polyglot
heuristic approach. Rationale: precise function/class counts and cyclomatic
complexity require a real parse tree; regex heuristics produce unreliable counts
on real code (arrow functions, methods, generics, JSX). The trade-off is narrower
language coverage, accepted deliberately. Basic metrics (file counts, line counts)
and the secret scan still run across **all** files so the language breakdown stays
meaningful.

### 2. Parser: `@babel/parser` + `@babel/traverse`

Node has no stable built-in JS AST API. Among third-party options:

- **`@babel/parser`** — one parser covers JS, TS, JSX, and TSX via plugins; mature
  traversal via `@babel/traverse`. **Chosen.**
- `typescript` compiler API — first-class TS but a heavier API for plain JS.
- Stdlib-only — would force regex heuristics, conflicting with the accuracy goal.

### 3. Modular pipeline over single-file script

Each analyzer is an isolated module with a defined input/output contract
(`scan → analyze → report`). This makes the analyzers unit-testable in isolation
and keeps files small and focused. A single-file script was rejected as hard to
test; a generic plugin/registry framework was rejected as over-engineered for
three analyzers (YAGNI).

### 4. ESM, Node v24

New code on Node 24 under "strict standards" — `"type": "module"` is the modern
default. (`package.json` is updated from `commonjs` to `module`.)

### 5. JSON as the single source of truth

The scanner builds one canonical result object. Markdown and HTML reporters render
from it rather than re-deriving data. This guarantees the three outputs never
disagree and makes the reporters trivial to test.

### 6. Self-contained HTML charts (inline SVG)

The HTML report embeds inline SVG charts instead of fetching a chart library from
a CDN. The report is a single portable file that works offline — important for a
tool that may run in sandboxed or air-gapped environments.

## Analysis feature notes

### Cyclomatic complexity
Standard count: start at 1, +1 per decision point (`if`/loop/`case`/`catch`/
ternary/logical operator). Default flag threshold `> 10` ("medium" sensitivity).
Bands: 1–10 ok, 11–20 refactor recommended, 21+ high risk. The same algorithm
backs the `.cursor/rules/cyclomatic-complexity.mdc` rule.

### Code duplication
Token-stream normalization (strip whitespace/comments, placeholder identifiers and
literals) lets us catch **near**-duplicates, not just exact copies. Windows of ≥ 5
code lines are hashed with a rolling hash and grouped. Percentage = duplicated
lines / total JS-TS code lines, each line counted once.

### Secret scanning
Language-agnostic regex ruleset (AWS keys, private-key blocks, generic API-key and
high-entropy credential assignments). Runs over all text files. Findings redact the
match middle so the report itself does not leak the secret.

## Scoring model

Start at 100 and subtract weighted penalties, clamped to `[0,100]`:

| Factor | Weight rationale |
|--------|------------------|
| Secrets | Heaviest — a leaked credential is the most serious finding |
| Complexity | Per flagged function, scaled by band (21+ worse than 11–20) |
| Duplication | Proportional to duplication percentage |

Grades: `A ≥ 90`, `B ≥ 80`, `C ≥ 70`, `D ≥ 60`, else `F`. The `score.breakdown`
field exposes each penalty so the number is explainable, not a black box.

## Explicitly out of scope (YAGNI)

- Non-JS/TS AST analysis.
- Analyzer plugin framework.
- Network-fetched chart libraries.
- Auto-fixing source.
