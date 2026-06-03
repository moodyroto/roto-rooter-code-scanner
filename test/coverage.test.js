import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTargetKey, moduleKey, analyzeCoverage } from '../src/analyzers/coverage.js';

test('testTargetKey derives module key from test conventions', () => {
  assert.equal(testTargetKey('/p/x/foo.test.ts'), '/p/x::foo');
  assert.equal(testTargetKey('/p/x/foo.spec.jsx'), '/p/x::foo');
  assert.equal(testTargetKey('/p/x/__tests__/foo.ts'), '/p/x::foo');
  assert.equal(testTargetKey('/p/x/__tests__/foo.test.ts'), '/p/x::foo');
  assert.equal(testTargetKey('/p/__mocks__/x.js'), null);
  assert.equal(testTargetKey('/p/plain.ts'), null);
});

test('moduleKey is dir::stem', () => {
  assert.equal(moduleKey('/p/x/foo.ts'), '/p/x::foo');
});

test('analyzeCoverage marks tested/untested and computes ratio', () => {
  const r = analyzeCoverage(['/p/a.js', '/p/b.js'], ['/p/a.test.js']);
  assert.equal(r.totalModules, 2);
  assert.equal(r.testedModules, 1);
  assert.equal(r.ratio, 0.5);
  assert.deepEqual(r.untested, ['/p/b.js']);
});

test('analyzeCoverage is path-aware (different dir does not credit)', () => {
  const r = analyzeCoverage(['/p/x/foo.ts'], ['/p/y/foo.test.js']);
  assert.equal(r.testedModules, 0);
  assert.deepEqual(r.untested, ['/p/x/foo.ts']);
});

test('analyzeCoverage ratio is 1 for an empty project', () => {
  const r = analyzeCoverage([], []);
  assert.equal(r.ratio, 1);
  assert.equal(r.totalModules, 0);
});
