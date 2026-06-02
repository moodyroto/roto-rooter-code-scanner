import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;

export const SECRET_RULES = [
  { name: 'aws-access-key', severity: 'high', regex: /(AKIA[0-9A-Z]{16})/ },
  { name: 'private-key-block', severity: 'high', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'generic-credential', severity: 'medium', regex: /(?:password|secret|token|api[_-]?key)\s*[:=]\s*['"]([^'"]{8,})['"]/i },
];

function redact(match) {
  if (match.length <= 6) return '*'.repeat(match.length);
  return `${match.slice(0, 3)}${'*'.repeat(match.length - 6)}${match.slice(-3)}`;
}

export function scanSecrets(content, filePath) {
  const findings = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    for (const rule of SECRET_RULES) {
      const m = line.match(rule.regex);
      if (m) {
        const sensitive = m[1] ?? m[0];
        findings.push({
          kind: 'secret', file: filePath, line: i + 1, rule: rule.name, severity: rule.severity,
          excerpt: line.trim().replaceAll(sensitive, redact(sensitive)).slice(0, 120),
        });
      }
    }
  });
  return findings;
}

const VM_METHODS = new Set(['runInThisContext', 'runInNewContext', 'runInContext']);
const TIMER_NAMES = new Set(['setTimeout', 'setInterval']);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'global', 'self']);

function isStringArg(arg) {
  return !!arg && (arg.type === 'StringLiteral' || arg.type === 'TemplateLiteral');
}

export function scanDangerousCalls(ast, content, filePath) {
  const lines = content.split('\n');
  const namespaceBindings = new Set(); // names bound to the child_process module object
  const directBindings = new Set();    // names bound to child_process exec/execSync

  // Pass 1: collect child_process bindings so we only flag exec/execSync on them.
  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== 'child_process') return;
      for (const spec of path.node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
          namespaceBindings.add(spec.local.name);
        } else if (spec.type === 'ImportSpecifier' && (spec.imported.name === 'exec' || spec.imported.name === 'execSync')) {
          directBindings.add(spec.local.name);
        }
      }
    },
    VariableDeclarator(path) {
      const init = path.node.init;
      if (!init || init.type !== 'CallExpression') return;
      const callee = init.callee;
      const isRequireCP = callee.type === 'Identifier' && callee.name === 'require'
        && init.arguments[0]?.type === 'StringLiteral' && init.arguments[0].value === 'child_process';
      if (!isRequireCP) return;
      const id = path.node.id;
      if (id.type === 'Identifier') {
        namespaceBindings.add(id.name);
      } else if (id.type === 'ObjectPattern') {
        for (const prop of id.properties) {
          if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier'
              && (prop.key.name === 'exec' || prop.key.name === 'execSync')
              && prop.value.type === 'Identifier') {
            directBindings.add(prop.value.name);
          }
        }
      }
    },
  });

  const findings = [];
  const add = (node, rule, severity) => {
    if (!node.loc) return;
    const line = node.loc.start.line;
    findings.push({
      kind: 'dangerous-call', file: filePath, line, rule, severity,
      excerpt: (lines[line - 1] ?? '').trim().slice(0, 120),
    });
  };

  // Pass 2: flag dangerous nodes.
  traverse(ast, {
    NewExpression(path) {
      const c = path.node.callee;
      if (c.type === 'Identifier' && c.name === 'Function') add(path.node, 'new-function', 'high');
    },
    CallExpression(path) {
      const callee = path.node.callee;
      const args = path.node.arguments;
      if (callee.type === 'Identifier') {
        if (callee.name === 'eval') { add(path.node, 'eval', 'high'); return; }
        if (callee.name === 'Function') { add(path.node, 'new-function', 'high'); return; }
        if (directBindings.has(callee.name)) { add(path.node, 'child-process-exec', 'high'); return; }
        if (TIMER_NAMES.has(callee.name) && isStringArg(args[0])) { add(path.node, 'string-timer', 'medium'); return; }
      } else if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        const prop = callee.property.name;
        if (VM_METHODS.has(prop)) { add(path.node, 'vm-run', 'high'); return; }
        if ((prop === 'exec' || prop === 'execSync')
            && callee.object.type === 'Identifier' && namespaceBindings.has(callee.object.name)) {
          add(path.node, 'child-process-exec', 'high'); return;
        }
        if (TIMER_NAMES.has(prop) && isStringArg(args[0])
            && callee.object.type === 'Identifier' && GLOBAL_OBJECTS.has(callee.object.name)) {
          add(path.node, 'string-timer', 'medium'); return;
        }
      }
    },
  });

  return findings;
}
