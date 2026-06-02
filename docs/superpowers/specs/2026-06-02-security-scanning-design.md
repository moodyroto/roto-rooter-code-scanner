# P1 — Security Scanning — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending written-spec review)
**Part of:** P1 of the P0–P3 rework. Builds on P0 (duplication removed).

## 1. Goal

Replace the standalone "secrets" feature with a broader **security** feature that
detects both hardcoded secrets (existing regex rules) and **dangerous function
calls** (new, AST-based). Findings are unified into one `security` section that
feeds scoring and the reports.

## 2. Decisions

| Decision | Choice |
|----------|--------|
| Result structure | Unify into `security: { findings: [...] }`; each finding tagged `kind` |
| Dangerous-call detection | AST-based, JS/TS only (reuses the parsed AST) |
| Secrets detection | Unchanged regex over all files |
| `child_process` handling | Import-aware binding tracking (avoid `RegExp.exec` false positives) |
| Module | Rename `src/analyzers/secrets.js` → `src/analyzers/security.js` |

## 3. Finding shape

```jsonc
{ "kind": "secret" | "dangerous-call",
  "rule": "aws-access-key" | "eval" | "child-process-exec" | ...,
  "severity": "high" | "medium" | "low",
  "file": "src/x.js",
  "line": 12,
  "excerpt": "…redacted (secrets) or trimmed source line (calls), ≤120 chars" }
```

## 4. Module: `src/analyzers/security.js`

Renamed from `secrets.js`. Keeps the existing exports plus a new one.

### 4.1 Secrets (existing, with `kind` added)
- `SECRET_RULES` unchanged: `aws-access-key` (high), `private-key-block` (high),
  `generic-credential` (medium).
- `scanSecrets(content, filePath) -> finding[]`: unchanged logic and redaction,
  but each finding now includes `kind: 'secret'`.

### 4.2 Dangerous calls (new)
`scanDangerousCalls(ast, content, filePath) -> finding[]` walks the AST with
`@babel/traverse` (interop: `const traverse = _traverse.default ?? _traverse`).
`content.split('\n')` provides excerpts (trimmed, ≤120 chars). Every finding has
`kind: 'dangerous-call'`.

**Pass 1 — collect `child_process` bindings** (to attribute `.exec`/`.execSync`):
- `ImportDeclaration` with `source.value === 'child_process'`:
  - namespace/default import → record the local name as a *namespace binding*.
  - named import `exec`/`execSync` → record the local name as a *direct binding*.
- `VariableDeclarator` whose `init` is a call to `require('child_process')`:
  - `id` is an `Identifier` → record name as a *namespace binding*.
  - `id` is an `ObjectPattern` → for each property whose key is `exec`/`execSync`,
    record the value name as a *direct binding*.

**Pass 2 — flag dangerous nodes:**

| Rule | Node match | Severity |
|------|-----------|----------|
| `eval` | `CallExpression`, `callee` is `Identifier` `eval` | high |
| `new-function` | `NewExpression` OR `CallExpression` with `callee` `Identifier` `Function` | high |
| `child-process-exec` | `CallExpression` where callee is `Identifier` in *direct bindings*, OR `MemberExpression` whose `object` is an `Identifier` in *namespace bindings* and `property` name is `exec`/`execSync` | high |
| `vm-run` | `CallExpression`, callee `MemberExpression` with `property` name `runInThisContext` / `runInNewContext` / `runInContext` | high |
| `string-timer` | `CallExpression` callee is `Identifier` `setTimeout`/`setInterval` (or `MemberExpression` `.setTimeout`/`.setInterval`), and `arguments[0]` is `StringLiteral` or `TemplateLiteral` | medium |

Notes:
- The two passes can be one `traverse` with both visitor handlers; binding
  collection happens in `ImportDeclaration`/`VariableDeclarator` visitors and the
  flagging in `CallExpression`/`NewExpression`. Because babel `traverse` visits
  parent nodes (imports/declarations at top) before nested call sites in source
  order, a single pass suffices for typical code where imports precede use. To be
  safe and simple, run traversal **twice**: first to populate the bindings set,
  then to flag. (Two short traversals; clarity over micro-optimization.)
- `.exec`/`.execSync` on a non-`child_process` receiver (e.g. `re.exec(str)`) is
  NOT flagged — that is the whole point of binding tracking.
- Each flagged node yields one finding at `node.loc.start.line`.

### 4.3 Severity → excerpt
- Secrets: redacted excerpt (existing behavior).
- Dangerous calls: `content.split('\n')[line-1].trim().slice(0, 120)` (no redaction).

## 5. Scanner integration (`src/scanner.js`)

- Import: `import { scanSecrets, scanDangerousCalls } from './analyzers/security.js';`
- Rename accumulator `secretFindings` → `securityFindings`.
- All files: `securityFindings.push(...scanSecrets(content, file));`
- Parsed JS/TS files (non-parseError branch): also
  `securityFindings.push(...scanDangerousCalls(parsed.ast, content, file));`
- Build `const security = { findings: securityFindings };`
- `const score = scoreResult({ complexity, security });`
- Result object: replace the `secrets` key with `security`.

Result object becomes `{ meta, summary, complexity, security, score, skipped }`.

## 6. Scoring (`src/score.js`)

- Signature `scoreResult({ complexity, security })`.
- `securityPenalty = -(security.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0))`.
- `breakdown = { security, complexity }`.
- `raw = 100 + breakdown.security + breakdown.complexity`. Clamp/round and grade
  unchanged. (Dangerous calls and secrets penalize identically by severity.)

## 7. Reporters

Both rename the "Secrets" section to **"Security"** and add a **Kind** column.

- **Markdown:** `## Security` with table columns `Kind, Rule, Severity, File, Line,
  Excerpt`. Penalties line: `secrets:` label becomes `security:` reading
  `score.breakdown.security`.
- **HTML:** `<h2>Security</h2>` table with the same columns (escaped via `esc`).

## 8. Error handling

- `scanDangerousCalls` runs only on successfully parsed ASTs (scanner guards
  parseError before calling it). A node lacking `loc` is skipped defensively.
- Binding tracking degrades gracefully: if no `child_process` import is found, no
  `.exec`/`.execSync` is flagged.

## 9. Testing

**`test/security.test.js`** (replaces `test/secrets.test.js`):
- Secrets (unchanged behavior, now with `kind: 'secret'`): AWS key redacted,
  generic credential, OpenSSH private key, no-leak, no-false-positive.
- Dangerous calls — positives:
  - `eval(userInput)` → rule `eval`, high.
  - `new Function('return 1')` → rule `new-function`, high.
  - `import { execSync } from 'child_process'; execSync(cmd)` → `child-process-exec`.
  - `const cp = require('child_process'); cp.exec(cmd)` → `child-process-exec`.
  - `vm.runInThisContext(code)` → `vm-run`, high.
  - `setTimeout('doThing()', 100)` → `string-timer`, medium.
- Dangerous calls — negatives:
  - `const m = re.exec(str)` (RegExp) → NOT flagged.
  - `setTimeout(() => {}, 1000)` → NOT flagged.
  - `obj.execSync(x)` where `obj` is not a child_process binding → NOT flagged.

**`test/score.test.js`** — use `security` instead of `secrets`; breakdown key
`security`.

**`test/scanner.test.js`** — assert `'security' in r` and `!('secrets' in r)`.

**`test/report-markdown.test.js` / `test/report-html.test.js`** — Security section
renders with a Kind column; fixtures use `security` and `breakdown.security`.

End-to-end: a fixture containing an `eval(...)` and a hardcoded key produces a
`security.findings` array with both kinds, and the report shows a Security section.

## 10. Out of scope (YAGNI)

- `child_process.spawn`/`execFile`, dynamic `require(variable)`, browser DOM sinks
  (`innerHTML`, `document.write`, `dangerouslySetInnerHTML`).
- Data-flow/taint analysis (we flag the call site, not whether input is untrusted).
- Severity tuning / per-rule score weights (uniform `-15 × severityMult`).
- Re-weighting against complexity (deferred until P3).
