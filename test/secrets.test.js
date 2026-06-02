import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets } from '../src/analyzers/secrets.js';

test('flags an AWS-style key and redacts the excerpt', () => {
  const content = 'const k = "AKIAIOSFODNN7EXAMPLE";\n';
  const findings = scanSecrets(content, 'c.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].severity, 'high');
  assert.ok(!findings[0].excerpt.includes('AKIAIOSFODNN7EXAMPLE'));
});

test('flags a generic credential assignment', () => {
  const findings = scanSecrets('password = "hunter2supersecret"\n', 'c.js');
  assert.ok(findings.some((f) => f.rule === 'generic-credential'));
});

test('no false positive on plain code', () => {
  assert.equal(scanSecrets('const sum = a + b;\n', 'c.js').length, 0);
});
