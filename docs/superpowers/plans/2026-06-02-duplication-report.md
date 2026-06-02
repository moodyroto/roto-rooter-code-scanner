# Duplication Report Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the duplication report show maximal duplicated blocks with which files duplicate each other and a code snippet (≤20 lines), rendered in JSON, Markdown, and HTML (HTML via pure-CSS fly-outs).

**Architecture:** Rewrite `findDuplication`'s cluster assembly to merge overlapping `minLines` windows into maximal blocks via signature-chaining, attach source snippets, then redesign the Markdown and HTML duplication sections to render per-cluster locations + snippets.

**Tech Stack:** Node v24, ESM, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-02-duplication-report-design.md`

---

## Cluster shape (locked)

```jsonc
{
  "lines": 10,                       // endLine - startLine + 1 of occurrence[0]
  "kind": "exact" | "near",
  "occurrences": [{ "file", "startLine", "endLine" }],
  "snippet": "…≤20 source lines…",
  "snippetOmitted": 0                // max(0, lines - 20)
}
```
`findDuplication(fileEntries, { minLines = 5 }) -> { percentage, clusters }` and `normalizeLines(content, tokens)` signatures are unchanged. Clusters sorted by `lines * occurrences.length` desc. Reporters render up to the top 50 clusters.

---

## Task 1: Merge windows into maximal blocks with snippets

**Files:**
- Modify: `src/analyzers/duplication.js` (replace the file)
- Test: `test/duplication.test.js` (extend — keep existing tests)

- [ ] **Step 1: Append failing tests to `test/duplication.test.js`**

```javascript
test('merges overlapping windows into one maximal block with a snippet', () => {
  const lines = ['function calc(a, b) {'];
  for (let i = 0; i < 8; i += 1) lines.push(`  const v${i} = a + b + ${i};`);
  lines.push('  return v0;', '}');
  const block = lines.join('\n'); // 11 lines
  const fa = parseFile(block, 'a.js');
  const fb = parseFile(block, 'b.js');
  const res = findDuplication([
    { file: 'a.js', content: block, tokens: fa.tokens },
    { file: 'b.js', content: block, tokens: fb.tokens },
  ], { minLines: 5 });

  assert.equal(res.clusters.length, 1);              // not many overlapping windows
  const c = res.clusters[0];
  assert.equal(c.lines, 11);
  assert.equal(c.occurrences.length, 2);
  assert.deepEqual(c.occurrences[0], { file: 'a.js', startLine: 1, endLine: 11 });
  assert.equal(c.kind, 'exact');
  assert.ok(c.snippet.startsWith('function calc(a, b) {'));
  assert.equal(c.snippetOmitted, 0);
});

test('caps the snippet at 20 lines and reports the omitted count', () => {
  const lines = ['function big() {'];
  for (let i = 0; i < 28; i += 1) lines.push(`  const v${i} = ${i} + 1;`);
  lines.push('}');
  const block = lines.join('\n'); // 30 lines
  const fa = parseFile(block, 'a.js');
  const fb = parseFile(block, 'b.js');
  const res = findDuplication([
    { file: 'a.js', content: block, tokens: fa.tokens },
    { file: 'b.js', content: block, tokens: fb.tokens },
  ], { minLines: 5 });

  const c = res.clusters[0];
  assert.equal(c.lines, 30);
  assert.equal(c.snippet.split('\n').length, 20);
  assert.equal(c.snippetOmitted, 10);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/duplication.test.js`
Expected: FAIL — the two new tests fail (current code yields multiple 5-line clusters and no `snippet`/`snippetOmitted` fields).

- [ ] **Step 3: Replace `src/analyzers/duplication.js` entirely with:**

```javascript
import crypto from 'node:crypto';

const SNIPPET_MAX = 20;

// Normalize identifiers/literals to type placeholders so renamed copies still match (near-dup).
function normToken(t) {
  const type = t.type?.label ?? t.type;
  if (type === 'name') return 'ID';
  if (type === 'num') return 'NUM';
  if (type === 'string' || type === 'template') return 'STR';
  if (type === '`') return 'STR';
  return t.value ?? type;
}

export function normalizeLines(content, tokens) {
  const rawLines = content.split('\n');
  const byLine = new Map(); // line -> normalized token strings
  for (const t of tokens ?? []) {
    if (!t.loc || (t.type?.label ?? t.type) === 'eof') continue;
    const ln = t.loc.start.line;
    if (!byLine.has(ln)) byLine.set(ln, []);
    byLine.get(ln).push(normToken(t));
  }
  const out = [];
  for (const [n, toks] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({ n, norm: toks.join(' '), raw: (rawLines[n - 1] ?? '').trim() });
  }
  return out;
}

function hash(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

function cmpOcc(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.startLine - b.startLine;
}

// Signature of a window-class: its sorted (file, startLine) set, optionally shifted by d lines.
function startSig(occ, d = 0) {
  return JSON.stringify(occ.map((o) => [o.file, o.startLine + d]));
}

export function findDuplication(fileEntries, { minLines = 5 } = {}) {
  const windows = new Map(); // normHash -> [{ file, startLine, endLine }]
  const contentLines = new Map(); // file -> original source lines
  let totalCodeLines = 0;

  for (const { file, content, tokens } of fileEntries) {
    const lines = normalizeLines(content, tokens);
    contentLines.set(file, content.split('\n'));
    totalCodeLines += lines.length;
    for (let i = 0; i + minLines <= lines.length; i += 1) {
      const slice = lines.slice(i, i + minLines);
      const normHash = hash(slice.map((l) => l.norm).join('\n'));
      if (!windows.has(normHash)) windows.set(normHash, []);
      windows.get(normHash).push({ file, startLine: slice[0].n, endLine: slice[slice.length - 1].n });
    }
  }

  // Keep only duplicated window-classes, keyed by their (file,startLine) signature.
  const classBySig = new Map();
  for (const occ of windows.values()) {
    if (occ.length < 2) continue;
    const sorted = [...occ].sort(cmpOcc);
    classBySig.set(startSig(sorted), sorted);
  }

  // Merge consecutive classes (each step shifts every start by +1) into maximal blocks.
  const blocks = [];
  for (const headOcc of classBySig.values()) {
    if (classBySig.has(startSig(headOcc, -1))) continue; // only start from a chain head
    let lastOcc = headOcc;
    while (classBySig.has(startSig(lastOcc, 1))) {
      lastOcc = classBySig.get(startSig(lastOcc, 1));
    }
    const occurrences = headOcc.map((h, idx) => ({
      file: h.file,
      startLine: h.startLine,
      endLine: lastOcc[idx].endLine,
    }));
    blocks.push(occurrences);
  }

  const clusters = blocks.map((occurrences) => {
    const snippets = occurrences.map((o) =>
      (contentLines.get(o.file) ?? []).slice(o.startLine - 1, o.endLine).join('\n'));
    const kind = snippets.every((s) => s === snippets[0]) ? 'exact' : 'near';
    const lines = occurrences[0].endLine - occurrences[0].startLine + 1;
    const srcLines = snippets[0].split('\n');
    const snippet = srcLines.slice(0, SNIPPET_MAX).join('\n');
    const snippetOmitted = Math.max(0, lines - SNIPPET_MAX);
    return { lines, kind, occurrences, snippet, snippetOmitted };
  });

  clusters.sort((a, b) => (b.lines * b.occurrences.length) - (a.lines * a.occurrences.length));

  const dupLineKeys = new Set();
  for (const c of clusters) {
    for (const o of c.occurrences) {
      for (let n = o.startLine; n <= o.endLine; n += 1) dupLineKeys.add(`${o.file}:${n}`);
    }
  }
  const percentage = totalCodeLines === 0 ? 0 : Number(((dupLineKeys.size / totalCodeLines) * 100).toFixed(2));

  return { percentage, clusters };
}
```

- [ ] **Step 4: Run the duplication tests, then the full suite**

Run: `node --test test/duplication.test.js`
Expected: PASS (existing exact/near/no-dup/normalizeLines tests AND the two new tests).

Run: `node --test`
Expected: all PASS. (The scanner test asserts only on summary/score, not cluster shape, so it stays green.)

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/duplication.js test/duplication.test.js
git commit -m "feat: merge duplication windows into maximal blocks with snippets"
```

---

## Task 2: Markdown duplication section

**Files:**
- Modify: `src/report/markdown.js`
- Test: `test/report-markdown.test.js` (extend)

- [ ] **Step 1: Append a failing test to `test/report-markdown.test.js`**

```javascript
test('renders duplication clusters with locations and a fenced snippet', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 20, code: 18, comments: 1, blanks: 1, functions: 2, classes: 0 },
    complexity: { threshold: 10, avg: 1, max: 1, flagged: [] },
    duplication: { percentage: 30, clusters: [
      { lines: 6, kind: 'near', snippet: 'function calc(a, b) {\n  return a + b;', snippetOmitted: 0,
        occurrences: [{ file: 'src/a.js', startLine: 1, endLine: 6 }, { file: 'src/b.js', startLine: 10, endLine: 15 }] },
    ] },
    secrets: { findings: [] },
    score: { value: 80, grade: 'B', breakdown: { secrets: 0, complexity: 0, duplication: -15 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('## Duplication: 30%'));
  assert.ok(md.includes('### Cluster 1 — near · 6 lines · 2 places'));
  assert.ok(md.includes('- src/a.js:1-6'));
  assert.ok(md.includes('- src/b.js:10-15'));
  assert.ok(md.includes('function calc(a, b) {'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/report-markdown.test.js`
Expected: FAIL — current output renders a `Kind | Lines | Occurrences` table, not cluster headings/snippets.

- [ ] **Step 3: Modify `src/report/markdown.js`**

(a) Add these two helpers immediately after the existing `table` function (before `export function toMarkdown`):

```javascript
function backtickFence(snippet) {
  const longest = (String(snippet).match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function dupClusters(clusters) {
  if (!clusters.length) return '_none_';
  const shown = clusters.slice(0, 50);
  const blocks = shown.map((c, i) => {
    const locs = c.occurrences.map((o) => `- ${o.file}:${o.startLine}-${o.endLine}`).join('\n');
    const fence = backtickFence(c.snippet);
    const more = c.snippetOmitted > 0 ? `\n… ${c.snippetOmitted} more lines` : '';
    return `### Cluster ${i + 1} — ${c.kind} · ${c.lines} lines · ${c.occurrences.length} places\n${locs}\n${fence}js\n${c.snippet}${more}\n${fence}`;
  });
  const extra = clusters.length > 50 ? `\n\n_… and ${clusters.length - 50} more clusters (see report.json)_` : '';
  return blocks.join('\n\n') + extra;
}
```

(b) Replace the Duplication section. The current lines are:

```javascript
## Duplication: ${duplication.percentage}%
${table(['Kind', 'Lines', 'Occurrences'], duplication.clusters.map((c) => [c.kind, String(c.lines), String(c.occurrences.length)]))}
```

Replace them with:

```javascript
## Duplication: ${duplication.percentage}%
${dupClusters(duplication.clusters)}
```

- [ ] **Step 4: Run the markdown tests, then the full suite**

Run: `node --test test/report-markdown.test.js`
Expected: PASS (the existing markdown tests still pass — the headline `## Duplication:` line is preserved).

Run: `node --test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/markdown.js test/report-markdown.test.js
git commit -m "feat: markdown duplication clusters with locations and snippets"
```

---

## Task 3: HTML duplication fly-outs

**Files:**
- Modify: `src/report/html.js`
- Test: `test/report-html.test.js` (extend)

- [ ] **Step 1: Append a failing test to `test/report-html.test.js`**

```javascript
test('renders duplication clusters as collapsible details with an escaped snippet', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 20, code: 18, comments: 1, blanks: 1, functions: 2, classes: 0 },
    complexity: { threshold: 10, avg: 1, max: 1, flagged: [] },
    duplication: { percentage: 30, clusters: [
      { lines: 6, kind: 'near', snippet: 'if (a < b && c) {\n  return "<x>";', snippetOmitted: 0,
        occurrences: [{ file: 'src/a.js', startLine: 1, endLine: 6 }, { file: 'src/b.js', startLine: 10, endLine: 15 }] },
    ] },
    secrets: { findings: [] },
    score: { value: 80, grade: 'B', breakdown: { secrets: 0, complexity: 0, duplication: -15 } },
    skipped: [],
  };
  const html = toHtml(r);
  assert.ok(html.includes('<details>'));
  assert.ok(html.includes('near · 6 lines · 2 places'));
  assert.ok(html.includes('src/a.js:1-6 ⇄ src/b.js:10-15'));
  assert.ok(html.includes('&lt;x&gt;'));           // snippet escaped
  assert.ok(!html.includes('return "<x>"'));        // raw snippet not present
  assert.ok(!html.includes('http://') && !html.includes('https://'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/report-html.test.js`
Expected: FAIL — current output renders a table, no `<details>`.

- [ ] **Step 3: Modify `src/report/html.js`**

(a) Add this helper immediately after the existing `rows` function (before `export function toHtml`):

```javascript
function dupDetails(clusters) {
  if (!clusters.length) return '<p><em>none</em></p>';
  const shown = clusters.slice(0, 50);
  const items = shown.map((c) => {
    const locs = c.occurrences.map((o) => `${esc(o.file)}:${o.startLine}-${o.endLine}`).join(' ⇄ ');
    const more = c.snippetOmitted > 0 ? `\n… ${c.snippetOmitted} more lines` : '';
    return `<details><summary>${esc(c.kind)} · ${c.lines} lines · ${c.occurrences.length} places</summary>`
      + `<div class="dup-locs">${locs}</div>`
      + `<pre><code>${esc(c.snippet + more)}</code></pre></details>`;
  }).join('\n');
  const extra = clusters.length > 50 ? `<p>… and ${clusters.length - 50} more clusters (see report.json)</p>` : '';
  return items + extra;
}
```

(b) Add CSS for the fly-outs. The current `<style>` block ends with this line:

```javascript
.cards{display:flex;gap:2rem;align-items:center}section{margin:1.5rem 0}
```

Replace that line with:

```javascript
.cards{display:flex;gap:2rem;align-items:center}section{margin:1.5rem 0}
summary{cursor:pointer}details{margin:.4rem 0}pre{background:#f6f8fa;padding:8px;overflow:auto;font-size:12px}.dup-locs{font-size:13px;margin:4px 0;color:#555}
```

(c) Replace the Duplication section. The current lines are:

```javascript
<section><h2>Duplication: ${duplication.percentage}%</h2>
${rows(['Kind', 'Lines', 'Occurrences'], duplication.clusters.map((c) => [c.kind, c.lines, c.occurrences.length]))}</section>
```

Replace them with:

```javascript
<section><h2>Duplication: ${duplication.percentage}%</h2>
${dupDetails(duplication.clusters)}</section>
```

- [ ] **Step 4: Run the html tests, then the full suite**

Run: `node --test test/report-html.test.js`
Expected: PASS (existing html tests still pass — `<!DOCTYPE html>`, `<svg`, no-URL assertions all hold).

Run: `node --test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/html.js test/report-html.test.js
git commit -m "feat: HTML duplication fly-outs with snippets"
```

---

## Task 4: Full suite + self-scan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: all tests PASS, no failures. If anything fails, STOP and report.

- [ ] **Step 2: Generate a report on a fixture with a real duplicate and inspect it**

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/src"
cat > "$TMP/src/a.js" <<'EOF'
export function calc(a, b) {
  const x = a + b;
  const y = x * 2;
  const z = y - a;
  const w = z + b;
  return w;
}
EOF
cat > "$TMP/src/b.js" <<'EOF'
export function compute(p, q) {
  const x = p + q;
  const y = x * 2;
  const z = y - p;
  const w = z + q;
  return w;
}
EOF
node src/cli.js "$TMP" --out "$TMP/report" --format json,md >/dev/null
echo "=== JSON cluster ==="
node --input-type=module -e "import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync('$TMP/report/report.json','utf8')); const c=j.duplication.clusters; console.log('clusters', c.length, '| pct', j.duplication.percentage); if(c[0]) console.log('first:', c[0].kind, c[0].lines+'L', JSON.stringify(c[0].occurrences), '| snippetOmitted', c[0].snippetOmitted)"
echo "=== Markdown duplication section ==="
node --input-type=module -e "import fs from 'node:fs'; const md=fs.readFileSync('$TMP/report/report.md','utf8'); console.log(md.slice(md.indexOf('## Duplication')))"
rm -rf "$TMP"
```
Expected: exactly **one** cluster (not several overlapping ones), `kind` is `near` (renamed identifiers), the two occurrences list `src/a.js` and `src/b.js` with line ranges, `snippetOmitted` is 0, and the Markdown section shows a `### Cluster 1` heading with both file ranges and a fenced snippet of the function body.

- [ ] **Step 3: No commit expected (verification only)**

```bash
git status --short
```

---

## Self-Review Notes

- **Spec coverage:** maximal-block merge via signature-chaining (T1 §4.2), snippet + cap + `snippetOmitted` (T1 §4.3), enriched cluster shape (T1 §4.4), Markdown per-cluster section with backtick-safe fence + 50-cap (T2 §5), HTML pure-CSS `<details>` fly-outs + escaping + 50-cap (T3 §6), unchanged `percentage` and `findDuplication`/`normalizeLines` signatures (T1), verification incl. the renamed-identifier near case (T4).
- **Type consistency:** cluster fields (`lines`, `kind`, `occurrences[{file,startLine,endLine}]`, `snippet`, `snippetOmitted`) are produced in T1 and consumed identically in T2 and T3.
- **Existing tests:** the scanner test asserts on summary/score only; the markdown/html tests assert the `## Duplication:`/`<h2>Duplication` headings which are preserved; all remain green.
