import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile, countDefinitions, commentLineNumbers } from '../src/analyzers/ast.js';

test('parses TS and counts functions and classes', () => {
  const src = 'class A {}\nfunction f(x: number) { return x; }\nconst g = () => 1;\n';
  const r = parseFile(src, 'x.ts');
  assert.ok(!r.parseError);
  const { functions, classes } = countDefinitions(r.ast);
  assert.equal(classes, 1);
  assert.equal(functions, 2); // function decl + arrow
});

test('returns parseError on broken input', () => {
  const r = parseFile('function (', 'x.js');
  assert.equal(r.parseError, true);
});

test('commentLineNumbers maps comment lines', () => {
  const r = parseFile('// hi\nconst a = 1;\n', 'x.js');
  assert.deepEqual([...commentLineNumbers(r.comments)], [1]);
});

test('commentLineNumbers ignores comments without loc', () => {
  assert.deepEqual([...commentLineNumbers([{ value: 'x' }])], []);
});
