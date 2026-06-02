import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestFile } from '../src/test-files.js';

test('matches *.test.* and *.spec.* across JS/TS extensions', () => {
  for (const f of ['foo.test.ts', 'bar.spec.jsx', 'comp.test.tsx', 'm.spec.mjs', 'n.test.cjs', 'p.spec.cts']) {
    assert.equal(isTestFile(f), true, f);
  }
});

test('matches files inside __tests__ and __mocks__ directories', () => {
  assert.equal(isTestFile('a/__tests__/b.ts'), true);
  assert.equal(isTestFile('x/__mocks__/api.js'), true);
  assert.equal(isTestFile('a\\__tests__\\b.ts'), true); // windows separators
});

test('does not match production files or near-misses', () => {
  for (const f of ['foo.ts', 'testUtils.ts', 'contest.ts', 'spec.ts', 'test/foo.ts', 'tests/foo.ts', 'a/__testsfoo__/b.ts']) {
    assert.equal(isTestFile(f), false, f);
  }
});
