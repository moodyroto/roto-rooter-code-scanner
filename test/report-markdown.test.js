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
