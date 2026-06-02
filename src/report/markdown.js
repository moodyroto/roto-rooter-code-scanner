function escCell(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(escCell).join(' | ')} |`).join('\n');
  return rows.length ? `${head}\n${body}` : '_none_';
}

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

export function toMarkdown(result) {
  const { meta, summary, complexity, duplication, secrets, score, skipped } = result;
  const langRows = Object.entries(summary.byLanguage).map(([k, v]) => [k, String(v)]);
  return `# Code Scan Report

**Target:** \`${meta.target}\`
**Scanned:** ${meta.scannedAt} (${meta.durationMs} ms)

## Score: ${score.value} / 100 — Grade: ${score.grade}

Penalties — secrets: ${score.breakdown.secrets}, complexity: ${score.breakdown.complexity}, duplication: ${score.breakdown.duplication}

## Summary

- Files: ${summary.totalFiles}
- Lines: ${summary.totalLines} (code ${summary.code}, comments ${summary.comments}, blanks ${summary.blanks})
- Functions: ${summary.functions}, Classes: ${summary.classes}

### Languages
${table(['Language', 'Files'], langRows)}

## Cyclomatic Complexity (threshold ${complexity.threshold}, avg ${complexity.avg}, max ${complexity.max})
${table(['Function', 'File', 'Line', 'Score', 'Band'], complexity.flagged.map((f) => [`\`${f.name}\``, f.file, String(f.line), String(f.score), f.band]))}

## Duplication: ${duplication.percentage}%
${dupClusters(duplication.clusters)}

## Secrets
${table(['Rule', 'Severity', 'File', 'Line', 'Excerpt'], secrets.findings.map((s) => [s.rule, s.severity, s.file, String(s.line), s.excerpt]))}

## Skipped
${table(['File', 'Reason'], skipped.map((s) => [s.file, s.reason]))}
`;
}
