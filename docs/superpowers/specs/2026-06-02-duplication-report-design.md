# Duplication Report Overhaul — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending written-spec review)
**Builds on:** the code-scanner (`docs/superpowers/specs/2026-06-02-code-scanner-design.md`)

## 1. Problem

The duplication section is unhelpful. Two issues:

1. **Window noise** — the analyzer emits one cluster per fixed `minLines` (5) sliding
   window, so a single 10-line duplicate becomes ~6 overlapping clusters.
2. **No location or code** — reporters print only `Kind / Lines / Occurrences`
   counts. A reader cannot see *which files* duplicate each other or *what* the
   duplicated code is.

## 2. Goals

- Report **maximal duplicated blocks**, not overlapping windows.
- Each block shows **which files** contain it and their line ranges ("a ⇄ b").
- Each block shows a **code snippet** (capped at 20 lines).
- Snippets appear in **all three formats**; HTML uses a pure-CSS collapsible
  fly-out (no JS — stays self-contained).

## 3. Decisions

| Decision | Choice |
|----------|--------|
| Merge algorithm | Signature-chain merge of window-classes (N-way maximal blocks) |
| Snippet source | Original source lines (preserve indentation), from `content` |
| Snippet cap | 20 lines; record omitted-line count |
| Snippet scope | JSON + Markdown + HTML |
| HTML interactivity | Pure-CSS `<details>` collapsible, no JavaScript |
| Display cap (MD/HTML) | Top 50 clusters by size; JSON always complete |
| Sort order | By block size (`lines × occurrences.length`) descending |
| `percentage` | Unchanged definition (duplicated lines / total code lines) |

## 4. Analyzer: `src/analyzers/duplication.js`

`normalizeLines` and the per-window hashing are unchanged. The cluster-assembly
section is replaced.

### 4.1 Window-classes
- Slide `minLines` windows; group by normalized hash. Keep only classes with ≥2
  occurrences.
- Each occurrence is `(file, startLine)` and belongs to exactly one window-class
  (the window starting at that position). Therefore a class is uniquely identified
  by its **signature** = the sorted set of its `(file, startLine)` locations.
- Build `classBySig: Map<sigKey, { occurrences: [{ file, startLine }], rawHashes }>`
  where `sigKey = JSON.stringify(sorted [[file, startLine], ...])`.

### 4.2 Signature-chain merge
- `shift(sig, +1)` = the same locations with each `startLine + 1`.
- A class `C` links to `next(C)` when `classBySig` contains `shift(sig(C), +1)`.
- A **head** is a class whose `shift(sig, -1)` is not in `classBySig`.
- From each head, walk `next` to the end of the chain. `chainLen` = number of
  classes in the chain.
- The merged block's occurrences: for each location `(file, s0)` in the head,
  `{ file, startLine: s0, endLine: s0 + (chainLen - 1) + (minLines - 1) }`.
- `lines` = `endLine - startLine + 1` (same for every occurrence in a block).

### 4.3 Snippet and kind
- For each block, take the **first** occurrence. Slice that file's original source
  lines (`content.split('\n')`) from `startLine..endLine` (1-based, inclusive).
  This preserves indentation and includes any interleaved blank/comment lines.
- If the block spans more than 20 lines: `snippet` = first 20 source lines joined
  by `\n`; `snippetOmitted` = `lines - 20`. Otherwise the full block;
  `snippetOmitted = 0`.
- `kind` = `exact` if the joined original source text of all occurrences is
  identical, else `near`.

### 4.4 Output

```jsonc
{
  "percentage": 12.5,
  "clusters": [
    {
      "lines": 10,
      "kind": "near",
      "occurrences": [
        { "file": "src/a.js", "startLine": 12, "endLine": 21 },
        { "file": "src/b.js", "startLine": 40, "endLine": 49 }
      ],
      "snippet": "function calc(a, b) {\n  const x = a + b;\n  ...",
      "snippetOmitted": 0
    }
  ]
}
```

Clusters sorted by `lines * occurrences.length` descending. `findDuplication`
signature is unchanged: `findDuplication(fileEntries, { minLines = 5 }) ->
{ percentage, clusters }`, where `fileEntries = [{ file, content, tokens }]`.

`normalizeLines(content, tokens)` is unchanged and still exported.

## 5. Reporter: `src/report/markdown.js`

Replace the duplication counts table. Header stays `## Duplication: <pct>%`.
Then, for each cluster (up to the top 50):

```
### Cluster <n> — <kind> · <lines> lines · <N> places
- <file>:<startLine>-<endLine>     (one bullet per occurrence)
<fence>js
<snippet>
… <snippetOmitted> more lines      (only if snippetOmitted > 0)
<fence>
```

- `<fence>` is a run of backticks **one longer** than the longest backtick run in
  the snippet (minimum three), so snippets containing ``` do not break the block.
- If there are more than 50 clusters, append: `_… and <M> more clusters (see
  report.json)_`.
- If there are no clusters, render `_none_`.

## 6. Reporter: `src/report/html.js`

Replace the duplication table with one pure-CSS collapsible per cluster (top 50):

```html
<details>
  <summary><kind> · <lines> lines · <N> places</summary>
  <div class="dup-locs"><file>:<s>-<e> ⇄ <file>:<s>-<e></div>
  <pre><code><escaped snippet>[… N more lines]</code></pre>
</details>
```

- Occurrences joined by ` ⇄ `. All dynamic text escaped via the existing `esc()`.
- Add minimal CSS for `summary { cursor: pointer }` and `pre { background:#f6f8fa;
  padding:8px; overflow:auto }`.
- No `<script>`, no external URLs — the report stays self-contained and offline.
- More than 50 clusters → append `<p>… and <M> more clusters (see report.json)</p>`.
- No clusters → `<p><em>none</em></p>`.

## 7. Result-object impact

Only `duplication.clusters[]` gains `snippet` and `snippetOmitted` and now holds
merged maximal blocks. All other result fields, the score, and the JSON reporter
are unaffected (JSON serializes whatever shape it is given).

## 8. Testing

**`test/duplication.test.js` (extend; keep existing)**
- A 10-line block duplicated across two files (minLines 5) → exactly **one**
  cluster with `lines === 10`, `occurrences.length === 2`, the two ranges
  spanning the full block, `snippet` containing the first source line, and
  `snippetOmitted === 0`.
- A >20-line identical block → `snippetOmitted > 0` and `snippet` has 20 lines.
- Existing exact/near/no-dup and percentage tests still pass.

**`test/report-markdown.test.js` (extend)**
- A result with one cluster (two occurrences, a short snippet) renders the
  `### Cluster 1` heading, both `file:start-end` bullets, and the snippet text
  inside a fenced block.

**`test/report-html.test.js` (extend)**
- The same result renders a `<details>` element containing the ` ⇄ `-joined
  locations and a `<pre>` with the escaped snippet; output still contains no
  `http://`/`https://`.

## 9. Out of scope (YAGNI) and known v1 limitations

- Cross-language duplication (still JS/TS only).
- Syntax highlighting in snippets.
- Configurable snippet cap or display cap (fixed at 20 / 50).
- Sub-line or token-level diffing within a block.
- Collapsing/merging blocks that are near-adjacent but not contiguous.

**Known limitations of the merge algorithm (accepted for v1):**
- **Cross-file only.** Window-classes are formed only when a normalized window
  appears in ≥2 distinct files, so a block duplicated *within a single file* is not
  reported. (Window chaining is keyed on code-line index space so blocks with
  interior blank lines stay whole — this was the critical bug fixed during build.)
- **Positional pairing.** When a window recurs an unequal number of times across
  files, occurrences are paired positionally (i-th with i-th) up to the smaller
  count; pathologically self-similar code may pair arbitrary-but-structurally-equal
  regions. Normal code is unaffected.
