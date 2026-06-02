import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, isJsTs } from '../src/languages.js';

test('detects JS/TS family by extension', () => {
  assert.equal(detectLanguage('a/b.js'), 'JavaScript');
  assert.equal(detectLanguage('a/b.tsx'), 'TypeScript');
  assert.equal(detectLanguage('a/b.json'), 'JSON');
  assert.equal(detectLanguage('a/b.unknownext'), null);
});

test('isJsTs is true only for JS/TS family', () => {
  assert.equal(isJsTs('x.ts'), true);
  assert.equal(isJsTs('x.json'), false);
});
