import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { fileComplexity, bandFor } from '../src/analyzers/complexity.js';

test('counts decision points (base 1 + branches)', () => {
  const src = `function f(a, b) {
    if (a) { return 1; }
    else if (b && a) { return 2; }
    for (let i = 0; i < 3; i++) {}
    return a ? 1 : 2;
  }`;
  const { ast } = parseFile(src, 'x.js');
  const { functions } = fileComplexity(ast);
  assert.equal(functions.length, 1);
  // base1 + if1 + elseif1 + &&1 + for1 + ternary1 = 6
  assert.equal(functions[0].score, 6);
  assert.equal(functions[0].name, 'f');
});

test('bandFor maps score to band', () => {
  assert.equal(bandFor(5), 'ok');
  assert.equal(bandFor(15), 'refactor');
  assert.equal(bandFor(25), 'high-risk');
});
