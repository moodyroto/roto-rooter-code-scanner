import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from '../src/report/html.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2, TypeScript: 1 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  secrets: { findings: [] },
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3 } },
  skipped: [],
};

test('produces self-contained HTML with inline SVG and no external script src', () => {
  const html = toHtml(result);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('88'));
  assert.ok(!html.includes('http://') && !html.includes('https://')); // no CDN
});

test('renders a skipped section', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 1, byLanguage: { JavaScript: 1 }, totalLines: 1, code: 1, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    secrets: { findings: [] },
    score: { value: 100, grade: 'A', breakdown: { secrets: 0, complexity: 0 } },
    skipped: [{ file: 'broken.ts', reason: 'parseError: x' }],
  };
  const html = toHtml(r);
  assert.ok(html.includes('Skipped'));
  assert.ok(html.includes('broken.ts'));
});
