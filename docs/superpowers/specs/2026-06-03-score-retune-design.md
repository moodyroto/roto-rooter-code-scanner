# Scoring Re-tune — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending written-spec review)

## 1. Goal

Re-tune the 0–100 quality score now that all four analyzers feed it. Replace the
mix of uncapped and inconsistently-capped category penalties with **per-category
budgets that sum to 100**, so no single category can floor the score and the grade
stays meaningful.

Scope: `src/score.js` and `test/score.test.js` only. The `breakdown` keys are
unchanged (`security`, `complexity`, `dependencies`, `coverage`), so the scanner
and both reporters need no changes.

## 2. Model

Start at 100 and subtract each category's penalty, capped at its budget:

| Category | Penalty (absolute) | Budget (cap) |
|----------|--------------------|--------------|
| Security | `Σ 15 × SEVERITY_MULT[f.severity]` over `security.findings` (high 1.0, medium 0.6, low 0.3; unknown → 0.3) | 40 |
| Complexity | `8 × (# high-risk flagged) + 3 × (# refactor flagged)` over `complexity.flagged` | 20 |
| Dependencies | `8 × dependencies.cycles.length` | 15 |
| Coverage | `Math.round(25 × (1 − coverage.ratio))` | 25 |

Budgets sum to **100**.

```
breakdown = {
  security:     -Math.min(40, securityPenalty),
  complexity:   -Math.min(20, complexityPenalty),
  dependencies: -Math.min(15, dependenciesPenalty),
  coverage:     -Math.min(25, coveragePenalty),
}
value = clamp(round(100 + security + complexity + dependencies + coverage), 0, 100)
grade = A≥90, B≥80, C≥70, D≥60, else F
```

Each `breakdown` value is the negative, post-cap penalty (a number ≤ 0). Defaults
remain: `dependencies = { cycles: [] }`, `coverage = { ratio: 1 }` so callers that
omit them get 0 penalty.

## 3. Rationale

- **Caps** on every category (security ≤40, complexity ≤20, deps ≤15, coverage ≤25)
  bound the worst case per category, so one noisy category cannot zero the score —
  the grade remains informative.
- **Budgets sum to 100**, so the floor (0) is only reached when every category is at
  its worst; the final `clamp` is a safety net, not the primary mechanism.
- **Absolute penalties** (not size-normalized) are kept for simplicity; a large
  messy codebase saturates a category's budget rather than scaling unboundedly.
- Split **Security 40 / Coverage 25 / Complexity 20 / Dependencies 15** reflects
  severity priority (a leaked secret or dangerous call is the most serious signal).

## 4. Changes vs the previous model

- Security: was uncapped → now capped at 40.
- Complexity: was uncapped → now capped at 20.
- Dependencies: cap 24 → **15**.
- Coverage: weight 20 → **25**.
- Per-finding penalty formulas and `SEVERITY_MULT` are unchanged.

## 5. Worked examples (drive the tests)

- Security `[high, medium]` (24) + complexity `[high-risk, refactor]` (11): both
  under budget → `100 − 24 − 11 = 65` / **D**. (Existing test value unchanged.)
- Dependencies: 1 cycle → −8; **4 cycles → −15** (capped, was −24).
- Coverage: ratio 0.4 → `−round(25 × 0.6) = −15` (was −12); ratio 1 → 0.
- Caps: 4 high-severity findings → penalty 60 → **−40**; 10 high-risk flagged →
  penalty 80 → **−20**.
- All four maxed: `100 − 40 − 20 − 15 − 25 = 0` / **F**.

## 6. Testing (`test/score.test.js`)

- Keep the clean (100/A) and the security+complexity (65/D) cases.
- Update the dependency-cap case: **4 cycles → breakdown.dependencies −15**; 1 cycle
  → −8.
- Update the coverage case: ratio 0.4 → **breakdown.coverage −15**; ratio 1 → 0.
- Add cap cases: security with 4 high findings → **breakdown.security −40**;
  complexity with ≥3 high-risk flagged (≥24 raw) → **breakdown.complexity −20**.
- Add an all-maxed case asserting **value 0 / grade F**.
- No other test file asserts exact score values (scanner checks `'value' in score`;
  reporter tests use fixed fixtures), so they are unaffected.

## 7. Out of scope (YAGNI)

- Size/relative normalization (per function, per 1k LOC).
- Configurable budgets/weights via CLI or config.
- Changing grade thresholds, `SEVERITY_MULT`, or per-finding penalty formulas.
- Any change to the result object, scanner, analyzers, or reporters.
