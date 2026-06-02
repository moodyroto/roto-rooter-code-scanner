import fs from 'node:fs';
import { traverse } from './traverse.js';
import { detectLanguage, isJsTs } from './languages.js';
import { lineMetrics } from './metrics/lines.js';
import { parseFile, countDefinitions, commentLineNumbers } from './analyzers/ast.js';
import { fileComplexity } from './analyzers/complexity.js';
import { findDuplication } from './analyzers/duplication.js';
import { scanSecrets } from './analyzers/secrets.js';
import { scoreResult } from './score.js';

export function scan(rootDir, { threshold = 10, ignore = [], gitignore = true } = {}) {
  const start = Date.now();
  const files = traverse(rootDir, { ignore, gitignore });

  const summary = { totalFiles: 0, byLanguage: {}, totalLines: 0, code: 0, comments: 0, blanks: 0, functions: 0, classes: 0 };
  const flagged = [];
  const allFnScores = [];
  const secretFindings = [];
  const dupEntries = [];
  const skipped = [];

  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); }
    catch (err) { skipped.push({ file, reason: `unreadable: ${err.code ?? err.message}` }); continue; }

    const language = detectLanguage(file) ?? 'Other';
    summary.totalFiles += 1;
    summary.byLanguage[language] = (summary.byLanguage[language] ?? 0) + 1;

    secretFindings.push(...scanSecrets(content, file));

    if (isJsTs(file)) {
      const parsed = parseFile(content, file);
      if (parsed.parseError) {
        skipped.push({ file, reason: `parseError: ${parsed.message}` });
        const m = lineMetrics(content);
        summary.totalLines += m.total; summary.code += m.code; summary.blanks += m.blanks;
        continue;
      }
      const commentLines = commentLineNumbers(parsed.comments);
      const m = lineMetrics(content, commentLines);
      summary.totalLines += m.total; summary.code += m.code; summary.comments += m.comments; summary.blanks += m.blanks;
      const defs = countDefinitions(parsed.ast);
      summary.functions += defs.functions; summary.classes += defs.classes;
      const { functions } = fileComplexity(parsed.ast);
      for (const fn of functions) {
        allFnScores.push(fn.score);
        if (fn.score > threshold) flagged.push({ file, line: fn.line, name: fn.name, score: fn.score, band: fn.band });
      }
      dupEntries.push({ file, content, tokens: parsed.tokens });
    } else {
      const m = lineMetrics(content);
      summary.totalLines += m.total; summary.code += m.code; summary.blanks += m.blanks;
    }
  }

  const duplication = findDuplication(dupEntries);
  const avg = allFnScores.length ? Number((allFnScores.reduce((a, b) => a + b, 0) / allFnScores.length).toFixed(2)) : 0;
  const max = allFnScores.length ? Math.max(...allFnScores) : 0;
  const complexity = { threshold, avg, max, flagged };
  const secrets = { findings: secretFindings };
  const score = scoreResult({ complexity, duplication, secrets });

  return {
    meta: { target: rootDir, scannedAt: new Date().toISOString(), durationMs: Date.now() - start },
    summary, complexity, duplication, secrets, score, skipped,
  };
}
