import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { extractImports, resolveImport, analyzeDependencies } from '../src/analyzers/dependencies.js';

test('extractImports collects static import/export-from, ignores require and dynamic import', () => {
  const src = [
    'import x from "./a";',
    'export { y } from "./b";',
    'export * from "./c";',
    'export const local = 1;',
    'const z = require("./d");',
    'const p = import("./e");',
  ].join('\n');
  const { ast } = parseFile(src, 'x.js');
  assert.deepEqual(extractImports(ast).sort(), ['./a', './b', './c']);
});

test('resolveImport resolves relative with extension and index, null for bare/unresolved', () => {
  const set = new Set(['/p/a.ts', '/p/dir/index.js']);
  assert.equal(resolveImport('/p/x.js', './a', set), '/p/a.ts');
  assert.equal(resolveImport('/p/x.js', './dir', set), '/p/dir/index.js');
  assert.equal(resolveImport('/p/x.js', 'react', set), null);
  assert.equal(resolveImport('/p/x.js', './missing', set), null);
});

test('analyzeDependencies detects a 2-file cycle and counts edges/externals', () => {
  const fileSet = new Set(['/p/a.js', '/p/b.js']);
  const entries = [
    { file: '/p/a.js', specifiers: ['./b', 'react'] },
    { file: '/p/b.js', specifiers: ['./a'] },
  ];
  const r = analyzeDependencies(entries, fileSet);
  assert.equal(r.cycles.length, 1);
  assert.deepEqual(r.cycles[0].files, ['/p/a.js', '/p/b.js']);
  assert.equal(r.summary.internalEdges, 2);
  assert.equal(r.summary.externalImports, 1);
  assert.equal(r.summary.modules, 2);
});

test('analyzeDependencies finds no cycle for an acyclic chain and ranks most-imported', () => {
  const fileSet = new Set(['/p/a.js', '/p/b.js', '/p/c.js']);
  const entries = [
    { file: '/p/a.js', specifiers: ['./b', './c'] },
    { file: '/p/b.js', specifiers: ['./c'] },
    { file: '/p/c.js', specifiers: [] },
  ];
  const r = analyzeDependencies(entries, fileSet);
  assert.equal(r.cycles.length, 0);
  assert.equal(r.mostImported[0].file, '/p/c.js');
  assert.equal(r.mostImported[0].importedBy, 2);
});
