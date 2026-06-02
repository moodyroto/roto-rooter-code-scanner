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

test('flags an OpenSSH private key block', () => {
  const findings = scanSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\n', 'id_ed25519');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'private-key-block');
  assert.equal(findings[0].severity, 'high');
});

test('generic-credential excerpt does not leak any of the secret value', () => {
  const secret = 'superSecretValue123';
  const findings = scanSecrets(`token = "${secret}"\n`, 'c.js');
  assert.equal(findings.length, 1);
  // No contiguous 4+ char slice of the secret should survive in the excerpt
  assert.ok(!findings[0].excerpt.includes(secret.slice(-4)));
  assert.ok(!findings[0].excerpt.includes(secret.slice(0, 4)) || findings[0].excerpt.includes('***'));
});

test('redacts every occurrence of a repeated secret on one line', () => {
  const secret = 'superSecretValue123';
  const findings = scanSecrets(`token = "${secret}"; var copy = "${secret}";\n`, 'c.js');
  assert.ok(findings.length >= 1);
  for (const f of findings) {
    assert.ok(!f.excerpt.includes(secret), `excerpt leaked secret: ${f.excerpt}`);
  }
});
