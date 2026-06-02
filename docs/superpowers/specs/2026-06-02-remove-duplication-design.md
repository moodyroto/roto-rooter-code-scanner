# P0 — Remove Duplication Detection — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending written-spec review)
**Part of:** the rework removing duplication and adding security / dependency /
test-coverage analysis (P0 of P0–P3).

## 1. Goal

Remove the code-duplication feature entirely and cleanly, leaving the scanner,
scoring, reporters, result shape, and tests consistent and all tests green. This
clears the way for the three new analysis features (separate specs).

## 2. Scope of removal

### Files deleted
- `src/analyzers/duplication.js`
- `test/duplication.test.js`
- `.cursor/rules/code-duplication.mdc`

### `src/scanner.js`
- Remove `import { findDuplication } from './analyzers/duplication.js';`
- Remove the `dupEntries` array and the `dupEntries.push({ file, content, tokens })`
  line in the JS/TS branch.
- Remove the `const duplication = findDuplication(dupEntries);` call.
- Remove `duplication` from the returned result object.
- Update the `scoreResult(...)` call to pass only `{ complexity, secrets }`.

### `src/score.js`
- Signature becomes `scoreResult({ complexity, secrets })`.
- Remove `duplicationPenalty` and the `duplication` key from `breakdown`.
- `raw = 100 + breakdown.secrets + breakdown.complexity`.

### `src/report/markdown.js`
- Remove the `backtickFence` and `dupClusters` helpers.
- Remove the `## Duplication: …%` section and its body.

### `src/report/html.js`
- Remove the `dupDetails` helper.
- Remove the duplication `<section>`.
- Remove the duplication-specific CSS line (`summary{…}details{…}pre{…}.dup-locs{…}`).

### Tests updated
- `test/score.test.js` — drop `duplication` from inputs and breakdown assertions;
  recompute expected values (see §4).
- `test/report-markdown.test.js` — remove the duplication-cluster test; remove
  `duplication` from any remaining fixtures.
- `test/report-html.test.js` — remove the duplication-details test; remove
  `duplication` from any remaining fixtures.
- `test/scanner.test.js` — remove any assertion or fixture field referencing
  `duplication` (the main test asserts result shape; ensure it does not check a
  `duplication` key).

### Docs
- `README.md` — remove "Code duplication (near-duplicate detection + percentage)"
  from the Features list.
- Historical spec/plan docs under `docs/superpowers/` are left as dated records and
  not edited.

## 3. Resulting shapes

**Result object:**
```jsonc
{ "meta", "summary", "complexity", "secrets", "score", "skipped" }
```
(no `duplication`).

**Score:**
```jsonc
{ "value", "grade", "breakdown": { "secrets", "complexity" } }
```

## 4. Scoring decision

Drop the duplication penalty without rebalancing. Complexity and secrets weights
are unchanged:
- Secrets: `-15 * severityMult` per finding (high 1.0, medium 0.6, low 0.3).
- Complexity: `-8` per high-risk flagged function, `-3` per refactor flagged.
- `value = clamp(round(100 + secretsPenalty + complexityPenalty), 0, 100)`.
- Grades unchanged: A≥90, B≥80, C≥70, D≥60, else F.

Scores trend slightly higher until P1–P3 add new penalties; weights will be tuned
when those features land. The `score.test.js` "penalized" case is recomputed:
previously `100 − 11 (complexity) − 10 (duplication) − 24 (secrets) = 55`; without
duplication it becomes `100 − 11 − 24 = 65` (grade D).

## 5. Reporter shape after removal

Markdown sections: Score, Summary, Languages, Cyclomatic Complexity, Secrets,
Skipped. HTML sections mirror these. No duplication section in either.

## 6. Error handling / edge cases

- No runtime behavior depends on `duplication` after removal; reporters no longer
  destructure it, so a result without the key renders cleanly.
- `@babel` tokens are still produced by `parseFile` (used by complexity); only the
  duplication consumer is removed. `parseFile`'s `tokens` option stays as-is.

## 7. Testing

- Full `node --test` passes with no references to duplication remaining
  (`grep -rn duplication src test` returns nothing in code/tests).
- `score.test.js` reflects the new signature and the recomputed 65/D case.
- End-to-end: `node src/cli.js src --out scan-report` produces JSON/MD/HTML with no
  duplication section and a valid score.

## 8. Out of scope

- Rebalancing complexity/secrets weights (deferred until P1–P3).
- Any new analysis feature (separate specs P1–P3).
- Editing historical spec/plan documents.
