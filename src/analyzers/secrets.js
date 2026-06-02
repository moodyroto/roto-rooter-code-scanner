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
        const sensitive = m[1] ?? m[0]; // redact the captured value when present, else the whole match
        findings.push({
          file: filePath, line: i + 1, rule: rule.name, severity: rule.severity,
          excerpt: line.trim().replace(sensitive, redact(sensitive)).slice(0, 120),
        });
      }
    }
  });
  return findings;
}
