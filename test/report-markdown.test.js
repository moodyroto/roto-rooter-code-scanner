import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/report/markdown.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  secrets: { findings: [] },
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3 } },
  skipped: [],
};

test('renders headline score and feature sections', () => {
  const md = toMarkdown(result);
  assert.ok(md.includes('# Code Scan Report'));
  assert.ok(md.includes('88') && md.includes('Grade: B'));
  assert.ok(md.includes('Cyclomatic Complexity'));
  assert.ok(md.includes('Secrets'));
  assert.ok(md.includes('| f |') || md.includes('`f`'));
});

test('escapes pipe characters in table cells', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 0, byLanguage: {}, totalLines: 0, code: 0, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    secrets: { findings: [{ rule: 'r', severity: 'high', file: 'a.js', line: 1, excerpt: 'a | b | c' }] },
    score: { value: 50, grade: 'F', breakdown: { secrets: -50, complexity: 0 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('a \\| b \\| c'));
});
