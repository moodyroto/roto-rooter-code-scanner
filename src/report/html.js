function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function barChart(entries) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const rows = entries.map(([label, v], i) => {
    const w = Math.round((v / max) * 240);
    const y = i * 26;
    return `<text x="0" y="${y + 13}" font-size="12">${esc(label)}</text>` +
      `<rect x="110" y="${y}" width="${w}" height="18" fill="#4c8bf5"></rect>` +
      `<text x="${118 + w}" y="${y + 13}" font-size="12">${v}</text>`;
  }).join('');
  return `<svg width="400" height="${entries.length * 26 + 4}" role="img">${rows}</svg>`;
}

function gauge(value) {
  const color = value >= 80 ? '#2e9e54' : value >= 60 ? '#d9a300' : '#cc3333';
  return `<svg width="120" height="120"><circle cx="60" cy="60" r="50" fill="none" stroke="#eee" stroke-width="12"/>` +
    `<text x="60" y="66" text-anchor="middle" font-size="28" fill="${color}">${value}</text></svg>`;
}

function rows(headers, data) {
  if (!data.length) return '<p><em>none</em></p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function toHtml(result) {
  const { meta, summary, complexity, security, score, skipped } = result;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Code Scan Report</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#222}
table{border-collapse:collapse;margin:.5rem 0}th,td{border:1px solid #ddd;padding:4px 8px;font-size:13px;text-align:left}
.cards{display:flex;gap:2rem;align-items:center}section{margin:1.5rem 0}
</style></head><body>
<h1>Code Scan Report</h1>
<p><strong>Target:</strong> ${esc(meta.target)} — ${esc(meta.scannedAt)} (${meta.durationMs} ms)</p>
<div class="cards">
  <div><h2>Score</h2>${gauge(score.value)}<p>Grade ${esc(score.grade)}</p></div>
  <div><h2>Languages</h2>${barChart(Object.entries(summary.byLanguage))}</div>
</div>
<section><h2>Summary</h2>
<p>Files: ${summary.totalFiles} · Lines: ${summary.totalLines} (code ${summary.code}, comments ${summary.comments}, blanks ${summary.blanks}) · Functions: ${summary.functions} · Classes: ${summary.classes}</p></section>
<section><h2>Cyclomatic Complexity (threshold ${complexity.threshold})</h2>
${barChart(complexity.flagged.slice(0, 10).map((f) => [`${f.name} (${f.file})`, f.score]))}
${rows(['Function', 'File', 'Line', 'Score', 'Band'], complexity.flagged.map((f) => [f.name, f.file, f.line, f.score, f.band]))}</section>
<section><h2>Security</h2>
${rows(['Kind', 'Rule', 'Severity', 'File', 'Line', 'Excerpt'], security.findings.map((s) => [s.kind, s.rule, s.severity, s.file, s.line, s.excerpt]))}</section>
<section><h2>Skipped</h2>
${rows(['File', 'Reason'], skipped.map((s) => [s.file, s.reason]))}</section>
</body></html>`;
}
