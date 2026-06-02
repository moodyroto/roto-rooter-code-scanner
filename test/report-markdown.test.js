import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/report/markdown.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  duplication: { percentage: 5, clusters: [] },
  secrets: { findings: [] },
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3, duplication: -2.5 } },
  skipped: [],
};

test('renders headline score and feature sections', () => {
  const md = toMarkdown(result);
  assert.ok(md.includes('# Code Scan Report'));
  assert.ok(md.includes('88') && md.includes('Grade: B'));
  assert.ok(md.includes('Cyclomatic Complexity'));
  assert.ok(md.includes('Duplication'));
  assert.ok(md.includes('Secrets'));
  assert.ok(md.includes('| f |') || md.includes('`f`'));
});

test('escapes pipe characters in table cells', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 0, byLanguage: {}, totalLines: 0, code: 0, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    duplication: { percentage: 0, clusters: [] },
    secrets: { findings: [{ rule: 'r', severity: 'high', file: 'a.js', line: 1, excerpt: 'a | b | c' }] },
    score: { value: 50, grade: 'F', breakdown: { secrets: -50, complexity: 0, duplication: 0 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('a \\| b \\| c'));
});

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
