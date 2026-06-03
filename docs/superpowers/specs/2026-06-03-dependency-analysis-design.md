# P2 — Dependency Analysis — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending written-spec review)
**Part of:** P2 of the P0–P3 rework. Builds on P0 (duplication removed) and P1 (security).

## 1. Goal

Map the internal module import graph and detect circular dependencies. Cycles are
the actionable signal: they are reported and penalize the quality score.

## 2. Decisions

| Decision | Choice |
|----------|--------|
| Graph scope | Internal modules only (resolved relative imports between scanned JS/TS files); bare/unresolved specifiers counted as external, not graph nodes |
| Import forms | Static only: `import … from`, `export … from`, `export * from` (no `require`, no dynamic `import()`) |
| Cycle representation | Strongly-connected components (set of mutually-dependent files); self-imports also count |
| Cycle detection | Tarjan SCC (linear) |
| Scoring | `dependenciesPenalty = -min(24, 8 × cycleCount)`; breakdown gains `dependencies` |
| Paths | Absolute, consistent with other findings |

## 3. Module: `src/analyzers/dependencies.js`

### 3.1 `extractImports(ast) -> string[]`
Returns the raw specifier strings (the `source.value`) from these node types:
- `ImportDeclaration` (includes TS `import type`).
- `ExportNamedDeclaration` **when `node.source` is non-null** (`export { x } from './y'`).
- `ExportAllDeclaration` (`export * from './y'`).

Nodes without a `source` (local `export { x }`) are ignored. `require()` and
dynamic `import()` are NOT collected. Uses `@babel/traverse`
(`const traverse = _traverse.default ?? _traverse`).

### 3.2 `resolveImport(importerAbs, specifier, fileSet) -> string | null`
- If `specifier` does not start with `.` or `/` → return `null` (bare/external,
  e.g. `react`, `lodash`, `node:fs`).
- Otherwise resolve `base = path.resolve(path.dirname(importerAbs), specifier)` and
  return the first candidate present in `fileSet`:
  1. `base` exactly.
  2. `base + ext` for ext in `.js .jsx .ts .tsx .mjs .cjs .mts .cts`.
  3. `base + '/index' + ext` for the same extensions.
- No candidate in `fileSet` → return `null` (unresolved; treated as external).

`fileSet` is a `Set<string>` of absolute paths of all scanned JS/TS files.

### 3.3 `analyzeDependencies(entries, fileSet) -> { cycles, summary, mostImported }`
- `entries`: `[{ file, specifiers }]` (absolute `file`, raw `specifiers`).
- For each entry, resolve each specifier:
  - resolved internal target (in `fileSet`, and not the importer itself) → add
    directed edge `file -> target`; increment `internalEdges`.
  - `null` → increment `externalImports`.
  - self-resolution (`target === file`) → record a self-import cycle and still
    increment `internalEdges`.
- Build adjacency among internal files. Run **Tarjan SCC**.
- `cycles`: one entry `{ files: [...] }` per SCC with ≥2 members (files sorted),
  plus one `{ files: [f] }` per self-import. Order cycles by descending size.
- `summary`: `{ modules, internalEdges, externalImports }` where `modules` =
  number of entries (scanned JS/TS files).
- `mostImported`: top 5 `{ file, importedBy }` by in-degree (fan-in), descending;
  ties broken by path. Files with 0 fan-in are excluded.

## 4. Scanner integration (`src/scanner.js`)

- In the parsed JS/TS branch, collect `importEntries.push({ file, specifiers: extractImports(parsed.ast) })`.
- Build `const jsFiles = new Set(files.filter((f) => isJsTs(f)));` (absolute paths
  from `traverse`).
- After the loop: `const dependencies = analyzeDependencies(importEntries, jsFiles);`
- `const score = scoreResult({ complexity, security, dependencies });`
- Add `dependencies` to the returned result object.

Result shape: `{ meta, summary, complexity, security, dependencies, score, skipped }`.

## 5. Scoring (`src/score.js`)

- Signature `scoreResult({ complexity, security, dependencies })`.
- `dependenciesPenalty = -Math.min(24, 8 * dependencies.cycles.length)`.
- `breakdown = { security, complexity, dependencies }`.
- `raw = 100 + breakdown.security + breakdown.complexity + breakdown.dependencies`.
  Clamp `[0,100]`, round; grades unchanged.

## 6. Reporters

New **"Dependencies"** section in both, after Complexity (before Security).

- **Markdown:**
  ```
  ## Dependencies
  Modules: <m> · Internal edges: <e> · External imports: <x>

  ### Circular dependencies (<n>)
  <table: Cycle # | Files (joined by ", ")>   // "_none_" if no cycles

  ### Most imported
  <table: File | Imported by>                 // "_none_" if empty
  ```
- **HTML:** an `<h2>Dependencies</h2>` section with the same summary line, a
  cycles table, and a most-imported table (all values via `esc`).

## 7. Error handling / edge cases

- `extractImports` runs only on parsed ASTs (scanner guards parseError first).
- A directory import resolving to `index.*` is handled by the `/index` candidates.
- An importer that resolves a specifier to itself is reported as a self-import
  cycle (rare; e.g. `export * from './self'`).
- No edges for unresolved/bare specifiers; they only bump `externalImports`.
- Empty project (no JS/TS) → `cycles: []`, zeroed summary, `mostImported: []`,
  `dependenciesPenalty` 0.

## 8. Testing

**`test/dependencies.test.js`** (uses `parseFile` from ast.js for ASTs):
- `extractImports`: collects `import x from './a'`, `export { y } from './b'`,
  `export * from './c'`; ignores `const z = require('./d')` and `import('./e')`
  and local `export { y }`.
- `resolveImport`: `'./a'` from `/p/x.js` resolves to `/p/a.ts` when in the set
  (extension resolution); `'./dir'` resolves to `/p/dir/index.js`; `'react'` and an
  unresolved relative path return `null`.
- `analyzeDependencies`:
  - a↔b (a imports b, b imports a) → exactly one cycle `{ files: [a, b] }`.
  - acyclic chain a→b→c → no cycles.
  - external/bare imports increment `externalImports`, add no edges.
  - `mostImported` ranks the most-imported file first.

**`test/score.test.js`** — add `dependencies` input; assert a 1-cycle case deducts
8 and breakdown has a `dependencies` key.

**`test/scanner.test.js`** — assert `'dependencies' in r` and that
`r.dependencies.cycles` is an array.

**`test/report-markdown.test.js` / `test/report-html.test.js`** — fixtures gain a
`dependencies` object; assert the Dependencies section and a rendered cycle.

End-to-end: a fixture with `a.js` ⇄ `b.js` produces one cycle, a `dependencies`
penalty, and a Dependencies section listing both files.

## 9. Out of scope (YAGNI)

- `require()` / dynamic `import()` resolution.
- TS `tsconfig` path aliases, package `exports` maps, `node_modules` resolution.
- Explicit cycle paths (ordered a→b→a) — SCC sets only.
- Layering/“depends on” visualizations beyond the most-imported table.
- Re-weighting security/complexity (deferred to P3).
