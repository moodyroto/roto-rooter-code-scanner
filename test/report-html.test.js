import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from '../src/report/html.js';

function result(over = {}) {
  return {
    meta: { target: '/x', scannedAt: 'now', durationMs: 5 },
    summary: { totalFiles: 3, byLanguage: { JavaScript: 2, TypeScript: 1 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 9, classes: 1 },
    complexity: { threshold: 10, avg: 4, max: 12, flagged: [] },
    security: { findings: [] },
    dependencies: { cycles: [], summary: { modules: 3, internalEdges: 0, externalImports: 0 }, mostImported: [] },
    coverage: { totalModules: 2, testedModules: 1, ratio: 0.5, untested: ['src/b.js'] },
    score: { value: 88, grade: 'B', breakdown: { security: 0, complexity: 0, dependencies: 0, coverage: -10 } },
    skipped: [],
    ...over,
  };
}

test('renders a self-contained dark dashboard (no external assets, no script)', () => {
  const html = toHtml(result());
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('88'));
  assert.ok(html.includes('Grade B'));
  assert.ok(html.includes('<details>'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('http://') && !html.includes('https://'));
});

test('hero verdict and KPI tiles reflect the data', () => {
  const html = toHtml(result());
  assert.ok(html.includes('Security'));
  assert.ok(html.includes('Coverage'));
  assert.ok(html.includes('50%'));
  assert.ok(html.includes('3 files'));
});

test('security finding is escaped and shown in its details section', () => {
  const html = toHtml(result({ security: { findings: [{ kind: 'dangerous-call', rule: 'eval', severity: 'high', file: 'a.js', line: 3, excerpt: 'eval("<x>")' }] } }));
  assert.ok(html.includes('Security findings'));
  assert.ok(html.includes('eval'));
  assert.ok(html.includes('&lt;x&gt;'));
  assert.ok(!html.includes('eval("<x>")'));
});

test('circular dependency is listed in its details section', () => {
  const html = toHtml(result({ dependencies: { cycles: [{ files: ['src/a.js', 'src/b.js'] }], summary: { modules: 2, internalEdges: 2, externalImports: 1 }, mostImported: [{ file: 'src/a.js', importedBy: 2 }] } }));
  assert.ok(html.includes('Circular Dependencies'));
  assert.ok(html.includes('src/a.js, src/b.js'));
});

test('untested modules and skipped files appear in their sections', () => {
  const html = toHtml(result({ skipped: [{ file: 'broken.ts', reason: 'parseError: x' }] }));
  assert.ok(html.includes('Untested modules'));
  assert.ok(html.includes('src/b.js'));
  assert.ok(html.includes('Skipped'));
  assert.ok(html.includes('broken.ts'));
});
