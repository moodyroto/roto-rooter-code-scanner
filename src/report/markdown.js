function escCell(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(escCell).join(' | ')} |`).join('\n');
  return rows.length ? `${head}\n${body}` : '_none_';
}

export function toMarkdown(result) {
  const { meta, summary, complexity, secrets, score, skipped } = result;
  const langRows = Object.entries(summary.byLanguage).map(([k, v]) => [k, String(v)]);
  return `# Code Scan Report

**Target:** \`${meta.target}\`
**Scanned:** ${meta.scannedAt} (${meta.durationMs} ms)

## Score: ${score.value} / 100 — Grade: ${score.grade}

Penalties — secrets: ${score.breakdown.secrets}, complexity: ${score.breakdown.complexity}

## Summary

- Files: ${summary.totalFiles}
- Lines: ${summary.totalLines} (code ${summary.code}, comments ${summary.comments}, blanks ${summary.blanks})
- Functions: ${summary.functions}, Classes: ${summary.classes}

### Languages
${table(['Language', 'Files'], langRows)}

## Cyclomatic Complexity (threshold ${complexity.threshold}, avg ${complexity.avg}, max ${complexity.max})
${table(['Function', 'File', 'Line', 'Score', 'Band'], complexity.flagged.map((f) => [`\`${f.name}\``, f.file, String(f.line), String(f.score), f.band]))}

## Secrets
${table(['Rule', 'Severity', 'File', 'Line', 'Excerpt'], secrets.findings.map((s) => [s.rule, s.severity, s.file, String(s.line), s.excerpt]))}

## Skipped
${table(['File', 'Reason'], skipped.map((s) => [s.file, s.reason]))}
`;
}
