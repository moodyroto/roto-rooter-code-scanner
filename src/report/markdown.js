function escCell(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(escCell).join(' | ')} |`).join('\n');
  return rows.length ? `${head}\n${body}` : '_none_';
}

export function toMarkdown(result) {
  const { meta, summary, complexity, security, dependencies, coverage, score, skipped } = result;
  const langRows = Object.entries(summary.byLanguage).map(([k, v]) => [k, String(v)]);
  return `# Code Scan Report

**Target:** \`${meta.target}\`
**Scanned:** ${meta.scannedAt} (${meta.durationMs} ms)

## Score: ${score.value} / 100 — Grade: ${score.grade}

Penalties — security: ${score.breakdown.security}, complexity: ${score.breakdown.complexity}, dependencies: ${score.breakdown.dependencies}, coverage: ${score.breakdown.coverage}

## Summary

- Files: ${summary.totalFiles}
- Lines: ${summary.totalLines} (code ${summary.code}, comments ${summary.comments}, blanks ${summary.blanks})
- Functions: ${summary.functions}, Classes: ${summary.classes}

### Languages
${table(['Language', 'Files'], langRows)}

## Cyclomatic Complexity (threshold ${complexity.threshold}, avg ${complexity.avg}, max ${complexity.max})
${table(['Function', 'File', 'Line', 'Score', 'Band'], complexity.flagged.map((f) => [`\`${f.name}\``, f.file, String(f.line), String(f.score), f.band]))}

## Dependencies
Modules: ${dependencies.summary.modules} · Internal edges: ${dependencies.summary.internalEdges} · External imports: ${dependencies.summary.externalImports}

### Circular dependencies (${dependencies.cycles.length})
${table(['Cycle', 'Files'], dependencies.cycles.map((c, i) => [String(i + 1), c.files.join(', ')]))}

### Most imported
${table(['File', 'Imported by'], dependencies.mostImported.map((m) => [m.file, String(m.importedBy)]))}

## Test Coverage
Coverage: ${Math.round(coverage.ratio * 100)}% — tested ${coverage.testedModules} / ${coverage.totalModules} modules

### Untested modules (${coverage.untested.length})
${table(['File'], coverage.untested.slice(0, 50).map((f) => [f]))}

## Security
${table(['Kind', 'Rule', 'Severity', 'File', 'Line', 'Excerpt'], security.findings.map((s) => [s.kind, s.rule, s.severity, s.file, String(s.line), s.excerpt]))}

## Skipped
${table(['File', 'Reason'], skipped.map((s) => [s.file, s.reason]))}
`;
}
