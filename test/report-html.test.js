import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from '../src/report/html.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2, TypeScript: 1 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  security: { findings: [] },
  dependencies: { cycles: [], summary: { modules: 0, internalEdges: 0, externalImports: 0 }, mostImported: [] },
  score: { value: 88, grade: 'B', breakdown: { security: 0, complexity: -3, dependencies: 0 } },
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
    security: { findings: [] },
    dependencies: { cycles: [], summary: { modules: 0, internalEdges: 0, externalImports: 0 }, mostImported: [] },
    score: { value: 100, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: 0 } },
    skipped: [{ file: 'broken.ts', reason: 'parseError: x' }],
  };
  const html = toHtml(r);
  assert.ok(html.includes('Skipped'));
  assert.ok(html.includes('broken.ts'));
});

test('renders a dependencies section with a circular dependency', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 4, code: 4, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    security: { findings: [] },
    dependencies: {
      cycles: [{ files: ['src/a.js', 'src/b.js'] }],
      summary: { modules: 2, internalEdges: 2, externalImports: 1 },
      mostImported: [{ file: 'src/b.js', importedBy: 1 }],
    },
    score: { value: 92, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: -8 } },
    skipped: [],
  };
  const html = toHtml(r);
  assert.ok(html.includes('Dependencies'));
  assert.ok(html.includes('src/a.js, src/b.js'));
  assert.ok(!html.includes('http://') && !html.includes('https://'));
});
