import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from '../src/report/html.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2, TypeScript: 1 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  duplication: { percentage: 5, clusters: [] },
  secrets: { findings: [] },
  score: { value: 88, grade: 'B', breakdown: { secrets: 0, complexity: -3, duplication: -2.5 } },
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
    duplication: { percentage: 0, clusters: [] },
    secrets: { findings: [] },
    score: { value: 100, grade: 'A', breakdown: { secrets: 0, complexity: 0, duplication: 0 } },
    skipped: [{ file: 'broken.ts', reason: 'parseError: x' }],
  };
  const html = toHtml(r);
  assert.ok(html.includes('Skipped'));
  assert.ok(html.includes('broken.ts'));
});

test('renders duplication clusters as collapsible details with an escaped snippet', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 20, code: 18, comments: 1, blanks: 1, functions: 2, classes: 0 },
    complexity: { threshold: 10, avg: 1, max: 1, flagged: [] },
    duplication: { percentage: 30, clusters: [
      { lines: 6, kind: 'near', snippet: 'if (a < b && c) {\n  return "<x>";', snippetOmitted: 0,
        occurrences: [{ file: 'src/a.js', startLine: 1, endLine: 6 }, { file: 'src/b.js', startLine: 10, endLine: 15 }] },
    ] },
    secrets: { findings: [] },
    score: { value: 80, grade: 'B', breakdown: { secrets: 0, complexity: 0, duplication: -15 } },
    skipped: [],
  };
  const html = toHtml(r);
  assert.ok(html.includes('<details>'));
  assert.ok(html.includes('near · 6 lines · 2 places'));
  assert.ok(html.includes('src/a.js:1-6 ⇄ src/b.js:10-15'));
  assert.ok(html.includes('&lt;x&gt;'));            // snippet escaped
  assert.ok(!html.includes('return "<x>"'));         // raw snippet not present
  assert.ok(!html.includes('http://') && !html.includes('https://'));
});
