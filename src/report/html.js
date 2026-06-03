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
