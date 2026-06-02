import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzers/ast.js';
import { scanSecrets, scanDangerousCalls } from '../src/analyzers/security.js';

function calls(src) {
  const { ast } = parseFile(src, 'x.js');
  return scanDangerousCalls(ast, src, 'x.js');
}
const rules = (src) => calls(src).map((f) => f.rule);

test('scanSecrets flags an AWS key, redacts it, and tags kind=secret', () => {
  const f = scanSecrets('const k = "AKIAIOSFODNN7EXAMPLE";\n', 'c.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'secret');
  assert.equal(f[0].severity, 'high');
  assert.ok(!f[0].excerpt.includes('AKIAIOSFODNN7EXAMPLE'));
});

test('scanSecrets still flags generic credential and OpenSSH key', () => {
  assert.ok(scanSecrets('password = "hunter2supersecret"\n', 'c.js').some((f) => f.rule === 'generic-credential'));
  assert.ok(scanSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\n', 'id').some((f) => f.rule === 'private-key-block'));
});

test('flags eval', () => {
  const f = calls('eval(userInput);\n');
  assert.deepEqual(f.map((x) => [x.rule, x.severity, x.kind]), [['eval', 'high', 'dangerous-call']]);
});

test('flags new Function', () => {
  assert.deepEqual(rules('const g = new Function("return 1");\n'), ['new-function']);
});

test('flags child_process exec via namespace require', () => {
  assert.deepEqual(rules('const cp = require("child_process");\ncp.exec(cmd);\n'), ['child-process-exec']);
});

test('flags child_process execSync via named import', () => {
  assert.deepEqual(rules('import { execSync } from "child_process";\nexecSync(cmd);\n'), ['child-process-exec']);
});

test('flags vm.runInThisContext', () => {
  assert.deepEqual(rules('vm.runInThisContext(code);\n'), ['vm-run']);
});

test('flags setTimeout with a string body', () => {
  assert.deepEqual(rules('setTimeout("doThing()", 100);\n'), ['string-timer']);
});

test('does NOT flag RegExp.exec, function-arg timers, or non-cp execSync', () => {
  assert.deepEqual(rules('const m = re.exec(str);\n'), []);
  assert.deepEqual(rules('setTimeout(() => {}, 1000);\n'), []);
  assert.deepEqual(rules('obj.execSync(x);\n'), []);
});
