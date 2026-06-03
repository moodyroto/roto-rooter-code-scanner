import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/report/markdown.js';

const result = {
  meta: { target: '/x', scannedAt: '2026-06-02T00:00:00Z', durationMs: 5 },
  summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 10, code: 8, comments: 1, blanks: 1, functions: 3, classes: 1 },
  complexity: { threshold: 10, avg: 4, max: 12, flagged: [{ file: 'a.js', line: 2, name: 'f', score: 12, band: 'refactor' }] },
  security: { findings: [] },
  dependencies: { cycles: [], summary: { modules: 0, internalEdges: 0, externalImports: 0 }, mostImported: [] },
  coverage: { totalModules: 0, testedModules: 0, ratio: 1, untested: [] },
  score: { value: 88, grade: 'B', breakdown: { security: 0, complexity: -3, dependencies: 0, coverage: 0 } },
  skipped: [],
};

test('renders headline score and feature sections', () => {
  const md = toMarkdown(result);
  assert.ok(md.includes('# Code Scan Report'));
  assert.ok(md.includes('88') && md.includes('Grade: B'));
  assert.ok(md.includes('Cyclomatic Complexity'));
  assert.ok(md.includes('Security'));
  assert.ok(md.includes('| f |') || md.includes('`f`'));
});

test('escapes pipe characters in table cells', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 0, byLanguage: {}, totalLines: 0, code: 0, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    security: { findings: [{ kind: 'secret', rule: 'r', severity: 'high', file: 'a.js', line: 1, excerpt: 'a | b | c' }] },
    dependencies: { cycles: [], summary: { modules: 0, internalEdges: 0, externalImports: 0 }, mostImported: [] },
    coverage: { totalModules: 0, testedModules: 0, ratio: 1, untested: [] },
    score: { value: 50, grade: 'F', breakdown: { security: -50, complexity: 0, dependencies: 0, coverage: 0 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('a \\| b \\| c'));
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
    coverage: { totalModules: 0, testedModules: 0, ratio: 1, untested: [] },
    score: { value: 92, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: -8, coverage: 0 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('## Dependencies'));
  assert.ok(md.includes('Circular dependencies (1)'));
  assert.ok(md.includes('src/a.js, src/b.js'));
  assert.ok(md.includes('Most imported'));
});

test('renders a test coverage section with untested modules', () => {
  const r = {
    meta: { target: '/x', scannedAt: 'now', durationMs: 1 },
    summary: { totalFiles: 2, byLanguage: { JavaScript: 2 }, totalLines: 4, code: 4, comments: 0, blanks: 0, functions: 0, classes: 0 },
    complexity: { threshold: 10, avg: 0, max: 0, flagged: [] },
    security: { findings: [] },
    dependencies: { cycles: [], summary: { modules: 2, internalEdges: 0, externalImports: 0 }, mostImported: [] },
    coverage: { totalModules: 2, testedModules: 1, ratio: 0.5, untested: ['src/b.js'] },
    score: { value: 90, grade: 'A', breakdown: { security: 0, complexity: 0, dependencies: 0, coverage: -10 } },
    skipped: [],
  };
  const md = toMarkdown(r);
  assert.ok(md.includes('## Test Coverage'));
  assert.ok(md.includes('50%'));
  assert.ok(md.includes('tested 1 / 2 modules'));
  assert.ok(md.includes('src/b.js'));
});
