# HTML Report Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the HTML report into a self-contained dark **dashboard** — hero score ring + color-coded KPI tiles + languages bar + pure-CSS `<details>` problem sections.

**Architecture:** Replace `toHtml` in `src/report/html.js`; keep `esc`/`rows`, drop the SVG `gauge`/`barChart`, add CSS helpers (`ring`, `kpi`, `langBar`, `detail`, color pickers). HTML reporter + its test only — no other files change.

**Tech Stack:** Node v24, ESM, `node:test`. Inline CSS only (no JS, no external assets).

**Spec:** `docs/superpowers/specs/2026-06-03-html-dashboard-design.md`

---

## Task 1: Rewrite the HTML reporter as a dashboard

**Files:**
- Modify: `src/report/html.js` (replace whole file)
- Test: `test/report-html.test.js` (replace whole file)

- [ ] **Step 1: Replace `test/report-html.test.js` entirely with:**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from '../src/report/html.js';

function result(over = {}) {
  return {
    meta: { target: '/x', scannedAt: 'now', durationMs: 5 },
    summary: { totalFiles: 3, byLanguage: { JavaScript: 2, TypeScript: 1 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 9, classes: 1 },
    complexity: { threshold: 10, avg: 4, max: 12, flagged: [] },
    security: { findings: [] },
    dependencies: { cycles: [], summary: { modules: 3, internalEdges: 0, externalImports: 0 }, mostImported: [] },
    coverage: { totalModules: 2, testedModules: 1, ratio: 0.5, untested: ['src/b.js'] },
    score: { value: 88, grade: 'B', breakdown: { security: 0, complexity: 0, dependencies: 0, coverage: -10 } },
    skipped: [],
    ...over,
  };
}

test('renders a self-contained dark dashboard (no external assets, no script)', () => {
  const html = toHtml(result());
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('88'));            // score value in hero ring
  assert.ok(html.includes('Grade B'));
  assert.ok(html.includes('<details>'));     // collapsible problem areas
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('http://') && !html.includes('https://'));
});

test('hero verdict and KPI tiles reflect the data', () => {
  const html = toHtml(result());
  assert.ok(html.includes('Security'));      // KPI label
  assert.ok(html.includes('Coverage'));      // KPI label
  assert.ok(html.includes('50%'));           // coverage value
  assert.ok(html.includes('3 files'));       // verdict line
});

test('security finding is escaped and shown in its details section', () => {
  const html = toHtml(result({ security: { findings: [{ kind: 'dangerous-call', rule: 'eval', severity: 'high', file: 'a.js', line: 3, excerpt: 'eval("<x>")' }] } }));
  assert.ok(html.includes('Security findings'));
  assert.ok(html.includes('eval'));
  assert.ok(html.includes('&lt;x&gt;'));      // excerpt escaped
  assert.ok(!html.includes('eval("<x>")'));   // raw not present
});

test('circular dependency is listed in its details section', () => {
  const html = toHtml(result({ dependencies: { cycles: [{ files: ['src/a.js', 'src/b.js'] }], summary: { modules: 2, internalEdges: 2, externalImports: 1 }, mostImported: [{ file: 'src/a.js', importedBy: 2 }] } }));
  assert.ok(html.includes('Circular Dependencies'));
  assert.ok(html.includes('src/a.js, src/b.js'));
});

test('untested modules and skipped files appear in their sections', () => {
  const html = toHtml(result({ skipped: [{ file: 'broken.ts', reason: 'parseError: x' }] }));
  assert.ok(html.includes('Untested modules'));
  assert.ok(html.includes('src/b.js'));       // untested module
  assert.ok(html.includes('Skipped'));
  assert.ok(html.includes('broken.ts'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/report-html.test.js`
Expected: FAIL — the old SVG report has no `Grade B`, `<details>`, `Circular Dependencies`, or `3 files` verdict.

- [ ] **Step 3: Replace `src/report/html.js` entirely with:**

```javascript
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rows(headers, data) {
  if (!data.length) return '<p class="muted">none</p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const GOOD = '#22c55e';
const WARN = '#f59e0b';
const BAD = '#ef4444';
const NEUTRAL = '#e2e8f0';
const LANG_COLORS = ['#4c8bf5', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444', '#14b8a6', '#eab308', '#64748b'];

function gradeColor(grade) {
  if (grade === 'A' || grade === 'B') return GOOD;
  if (grade === 'C') return WARN;
  return BAD;
}

function coverageColor(ratio) {
  if (ratio >= 0.8) return GOOD;
  if (ratio >= 0.5) return WARN;
  return BAD;
}

function ring(value, color) {
  return `<div class="ring" style="background:conic-gradient(${color} 0 ${value}%,#1e293b 0)">`
    + `<div class="ring-inner" style="color:${color}">${value}</div></div>`;
}

function kpi(value, label, color) {
  return `<div class="kpi"><div class="kpi-n" style="color:${color}">${esc(value)}</div>`
    + `<div class="kpi-l">${esc(label)}</div></div>`;
}

function langBar(byLanguage, totalFiles) {
  const entries = Object.entries(byLanguage);
  if (!entries.length || !totalFiles) return '<p class="muted">no files</p>';
  const segs = entries.map(([lang, n], i) => {
    const pctW = (n / totalFiles) * 100;
    return `<i style="width:${pctW}%;background:${LANG_COLORS[i % LANG_COLORS.length]}" title="${esc(lang)}: ${n}"></i>`;
  }).join('');
  const legend = entries.map(([lang, n], i) =>
    `<span class="lg"><i style="background:${LANG_COLORS[i % LANG_COLORS.length]}"></i>${esc(lang)} ${n}</span>`).join('');
  return `<div class="langbar">${segs}</div><div class="legend">${legend}</div>`;
}

function detail(title, count, color, bodyHtml) {
  return `<details><summary><span>${esc(title)}</span>`
    + `<span class="pill" style="background:${color}22;color:${color}">${esc(count)}</span></summary>`
    + `<div class="detail-body">${bodyHtml}</div></details>`;
}

export function toHtml(result) {
  const { meta, summary, complexity, security, dependencies, coverage, score, skipped } = result;
  const pct = Math.round(coverage.ratio * 100);
  const secN = security.findings.length;
  const cycN = dependencies.cycles.length;
  const cxN = complexity.flagged.length;
  const verdict = `${summary.totalFiles} files · ${summary.functions} functions · ${secN} security · ${cycN} cycle${cycN === 1 ? '' : 's'} · ${pct}% covered`;

  const kpis = [
    kpi(secN, 'Security', secN ? BAD : GOOD),
    kpi(cycN, 'Circular deps', cycN ? WARN : GOOD),
    kpi(`${pct}%`, 'Coverage', coverageColor(coverage.ratio)),
    kpi(cxN, 'Complex fns', cxN ? WARN : GOOD),
    kpi(summary.totalFiles, 'Files', NEUTRAL),
    kpi(summary.functions, 'Functions', NEUTRAL),
  ].join('');

  const securityBody = rows(['Kind', 'Rule', 'Severity', 'File', 'Line', 'Excerpt'],
    security.findings.map((s) => [s.kind, s.rule, s.severity, s.file, s.line, s.excerpt]));
  const complexityBody = `<p class="muted">threshold ${complexity.threshold} · avg ${complexity.avg} · max ${complexity.max}</p>`
    + rows(['Function', 'File', 'Line', 'Score', 'Band'], complexity.flagged.map((f) => [f.name, f.file, f.line, f.score, f.band]));
  const depsBody = `<p class="muted">modules ${dependencies.summary.modules} · internal edges ${dependencies.summary.internalEdges} · external imports ${dependencies.summary.externalImports}</p>`
    + rows(['Cycle', 'Files'], dependencies.cycles.map((c, i) => [i + 1, c.files.join(', ')]))
    + '<h4>Most imported</h4>'
    + rows(['File', 'Imported by'], dependencies.mostImported.map((m) => [m.file, m.importedBy]));
  const coverageBody = `<p class="muted">tested ${coverage.testedModules} / ${coverage.totalModules} modules</p>`
    + rows(['Untested module'], coverage.untested.slice(0, 50).map((f) => [f]));
  const skippedBody = rows(['File', 'Reason'], skipped.map((s) => [s.file, s.reason]));

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Code Scan Report</title>
<style>
:root{color-scheme:dark}
body{font-family:system-ui,sans-serif;margin:0;padding:2rem;background:#0b1220;color:#e2e8f0}
h1{font-size:18px;margin:0 0 2px}
.muted{color:#94a3b8;font-size:12px}
.hero{display:flex;gap:18px;align-items:center;margin:18px 0}
.ring{width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}
.ring-inner{width:64px;height:64px;border-radius:50%;background:#0b1220;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800}
.grade{font-size:15px;font-weight:700}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:16px 0}
.kpi{background:#1e293b;border-radius:10px;padding:12px}
.kpi-n{font-size:22px;font-weight:800;line-height:1}
.kpi-l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-top:6px}
.langbar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#1e293b;margin:6px 0}
.langbar>i{display:block;height:100%}
.legend{font-size:11px;color:#94a3b8;display:flex;gap:12px;flex-wrap:wrap}
.legend .lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px}
.label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-top:18px}
details{background:#1e293b;border-radius:10px;margin:8px 0;padding:0 12px}
summary{cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:11px 0;font-weight:600;list-style:none}
summary::-webkit-details-marker{display:none}
.pill{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:700}
.detail-body{padding:0 0 12px}
table{border-collapse:collapse;margin:.4rem 0;width:100%}
th,td{border:1px solid #334155;padding:4px 8px;font-size:12px;text-align:left}
th{color:#94a3b8;font-weight:600}
h4{margin:12px 0 4px;font-size:12px;color:#94a3b8}
</style></head><body>
<h1>Code Scan Report</h1>
<div class="muted">${esc(meta.target)} — ${esc(meta.scannedAt)} (${meta.durationMs} ms)</div>
<div class="hero">
  ${ring(score.value, gradeColor(score.grade))}
  <div>
    <div class="grade" style="color:${gradeColor(score.grade)}">Grade ${esc(score.grade)} · ${score.value}/100</div>
    <div class="muted">${esc(verdict)}</div>
  </div>
</div>
<div class="kpis">${kpis}</div>
<div class="label">Languages</div>
${langBar(summary.byLanguage, summary.totalFiles)}
<div class="label">Problem areas</div>
${detail('Security findings', secN, secN ? BAD : GOOD, securityBody)}
${detail('Complex functions', cxN, cxN ? WARN : GOOD, complexityBody)}
${detail('Circular Dependencies', cycN, cycN ? WARN : GOOD, depsBody)}
${detail('Untested modules', coverage.untested.length, coverage.untested.length ? WARN : GOOD, coverageBody)}
${detail('Skipped files', skipped.length, skipped.length ? WARN : GOOD, skippedBody)}
</body></html>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/report-html.test.js`
Expected: PASS (5 tests). Then `node --test` — ALL PASS (Markdown/JSON/scanner tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/report/html.js test/report-html.test.js
git commit -m "feat: redesign HTML report as a self-contained dashboard"
```

---

## Task 2: Full suite + visual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `node --test`
Expected: ALL PASS.

- [ ] **Step 2: Generate a real report and check the dashboard structure**

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/src"
printf 'export const a = 1;\nexport function f(x){ if(x){return 1;} return 2; }\n' > "$TMP/src/a.js"
printf 'const k = "AKIAIOSFODNN7EXAMPLE";\neval(k);\n' > "$TMP/src/danger.js"
node src/cli.js "$TMP" --out "$TMP/r" --format html >/dev/null
node --input-type=module -e "import fs from 'node:fs'; const h=fs.readFileSync('$TMP/r/report.html','utf8'); const has=(s)=>console.log((h.includes(s)?'ok ':'MISSING ')+s); has('<!DOCTYPE html>'); has('<style>'); has('class=\"hero\"'); has('class=\"kpis\"'); has('class=\"ring\"'); has('<details>'); has('Security findings'); has('Circular Dependencies'); has('Untested modules'); console.log('external refs:', /https?:\/\//.test(h) ? 'FOUND (bad)' : 'none'); console.log('script tags:', h.includes('<script') ? 'FOUND (bad)' : 'none'); console.log('bytes', h.length)"
echo "Report written to $TMP/r/report.html (open to eyeball the dark dashboard if desired)"
echo "$TMP"
```
Expected: every `has(...)` prints `ok`, external refs `none`, script tags `none`. (The temp dir path is printed so the report can be opened in a browser to eyeball it; remove it afterward.)

- [ ] **Step 3: Clean up**

```bash
# replace <TMP> with the path printed above
rm -rf <TMP>
git status --short
```

---

## Self-Review Notes

- **Spec coverage:** hero ring + grade + verdict, 6 color-coded KPI tiles, languages bar, five `<details>` problem sections (T1); self-contained CSS-only, no JS (T1 code + tests); test updates swapping the SVG assertion for self-contained checks while preserving data assertions (T1 test); full-suite + structural verification (T2).
- **Type consistency:** reads the existing result fields (`summary`, `complexity.flagged`, `security.findings`, `dependencies.{cycles,summary,mostImported}`, `coverage.{ratio,testedModules,totalModules,untested}`, `score.{value,grade}`, `skipped`) — no result-shape change.
- **Section title note:** the dependencies section is titled `Circular Dependencies` (capital D) so the data still reads naturally; coverage surfaces as the `Coverage` KPI plus the `Untested modules` section (there is no longer a literal "Test Coverage" heading — the test asserts `Coverage`/`Untested modules` instead).
- **Placeholder scan:** full code in every step; no TBDs.
