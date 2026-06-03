# HTML Report Dashboard — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending written-spec review)

## 1. Goal

Redesign the HTML report (`src/report/html.js` / `toHtml`) into a high-level,
visually engaging **dashboard**: an at-a-glance overview first, with problem
details one click away (secondary). JSON stays the canonical data; the Markdown
reporter is unchanged. Scope is the HTML reporter only — no change to the result
object, scoring, scanner, or other reporters.

## 2. Decisions

| Decision | Choice |
|----------|--------|
| Layout | Concept A: hero score + KPI tile grid + collapsible problem sections |
| Theme | Dark (slate background, neon accents) |
| Charts | CSS only (conic-gradient ring, flex stacked bar) — replaces the inline-SVG gauge/bars |
| Drill-down | Pure-CSS `<details>`/`<summary>` (no JavaScript) |
| Self-contained | Inline `<style>` only; no external CSS/JS/fonts/CDN |
| KPI tiles | Security, Circular deps, Coverage, Complex fns, Files, Functions |

## 3. Page structure (top → bottom)

1. **Header** — title + target/scanned line (`meta`).
2. **Hero** — a CSS **ring** (`conic-gradient(<gradeColor> 0 <value>%, #1e293b 0)`
   with an inner disc showing `score.value`), the grade, and a verdict line:
   `<files> files · <functions> functions · <security> security · <cycles> cycle(s)
   · <pct>% covered`.
3. **KPI grid** — 6 tiles, each `{ value, label }` with a severity color on the value:
   - Security = `security.findings.length` — 0 → green, else red.
   - Circular deps = `dependencies.cycles.length` — 0 → green, else amber.
   - Coverage = `Math.round(coverage.ratio*100)%` — ≥80 green / ≥50 amber / else red.
   - Complex fns = `complexity.flagged.length` — 0 → green, else amber.
   - Files = `summary.totalFiles` — neutral.
   - Functions = `summary.functions` — neutral.
4. **Languages bar** — slim stacked horizontal bar from `summary.byLanguage`
   (segment width = files / totalFiles), with a small legend; degrades to nothing
   when there are no files.
5. **Problem areas** — pure-CSS `<details>` (collapsed by default), each `<summary>`
   carrying a count pill, expanding to the existing tables (via the `rows` helper):
   - **Security findings** — pill `findings.length`; table Kind/Rule/Severity/File/Line/Excerpt.
   - **Complex functions** — pill `flagged.length`; table Function/File/Line/Score/Band; summary notes threshold/avg/max.
   - **Circular dependencies** — pill `cycles.length`; modules/edges/external line, cycles table, most-imported table.
   - **Untested modules** — pill `untested.length`; coverage line + untested table (top 50).
   - **Skipped files** — pill `skipped.length`; table File/Reason.

## 4. Color tokens (dark theme)

| Token | Value |
|-------|-------|
| background | `#0b1220` |
| surface (tiles/details) | `#1e293b` |
| text / muted | `#e2e8f0` / `#94a3b8` |
| good (green) | `#22c55e` |
| warn (amber) | `#f59e0b` |
| bad (red) | `#ef4444` |
| accent (bars) | `#4c8bf5` |

Helpers:
- `gradeColor(grade)` → A/B green, C amber, D/F red.
- `coverageColor(ratio)` → ≥0.8 good, ≥0.5 warn, else bad.
- pill background derives from the tile/section color at low opacity.

## 5. Implementation (`src/report/html.js`)

- Keep `esc` and `rows`. Remove `gauge` and `barChart` (SVG). Add small helpers:
  `ring(value, color)`, `kpi(value, label, color)`, `langBar(byLanguage, totalFiles)`,
  `detail(title, count, color, bodyHtml)` (renders one `<details>`), and the two
  color helpers.
- `toHtml(result)` composes header + hero + KPI grid + languages + the five
  `<details>` sections, wrapped in `<!DOCTYPE html>` with an inline `<style>` block.
- No external resources; no `<script>`. All dynamic text via `esc`.

## 6. Testing (`test/report-html.test.js`)

- Replace the inline-SVG assertion. The "self-contained" test asserts:
  `startsWith('<!DOCTYPE html>')`, `includes('<style>')`, includes the score value
  (`88`) and grade, no `http://`/`https://`, and **no `<script`**.
- Keep the existing data assertions (they remain present in the collapsible
  sections): Dependencies cycle `src/a.js, src/b.js`; Test Coverage `50%` and
  `src/b.js`; Skipped `broken.ts`.
- Add assertions for the dashboard: a KPI label (e.g. `Security`), the verdict/grade,
  and that `<details>` is used.
- Markdown and JSON tests are untouched.

## 7. Error handling / edge cases

- Empty `byLanguage` → languages bar renders empty (no crash).
- Sections with zero items → `<summary>` shows a green `0`/none pill; body uses the
  `rows` "none" fallback.
- `coverage.ratio` of 1 → 100%, green.
- All values HTML-escaped; report remains a single self-contained file.

## 8. Out of scope (YAGNI)

- JavaScript interactivity beyond `<details>` (filtering, sorting, tabs).
- Theme toggle / light mode.
- Changes to JSON, Markdown, scanner, score, or analyzers.
- New metrics not already in the result object.
