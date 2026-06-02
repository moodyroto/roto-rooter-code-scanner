import crypto from 'node:crypto';

// Normalize identifiers/literals to type placeholders so renamed copies still match (near-dup).
function normToken(t) {
  const type = t.type?.label ?? t.type;
  if (type === 'name') return 'ID';
  if (type === 'num') return 'NUM';
  if (type === 'string' || type === 'template') return 'STR';
  if (type === '`') return 'STR';
  return t.value ?? type;
}

export function normalizeLines(content, tokens) {
  const rawLines = content.split('\n');
  const byLine = new Map(); // line -> normalized token strings
  for (const t of tokens ?? []) {
    if (!t.loc || (t.type?.label ?? t.type) === 'eof') continue;
    const ln = t.loc.start.line;
    if (!byLine.has(ln)) byLine.set(ln, []);
    byLine.get(ln).push(normToken(t));
  }
  const out = [];
  for (const [n, toks] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({ n, norm: toks.join(' '), raw: (rawLines[n - 1] ?? '').trim() });
  }
  return out;
}

function hash(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

export function findDuplication(fileEntries, { minLines = 5 } = {}) {
  const windows = new Map(); // normHash -> [{ file, startLine, endLine, rawHash }]
  const perFileLines = [];
  let totalCodeLines = 0;

  for (const { file, content, tokens } of fileEntries) {
    const lines = normalizeLines(content, tokens);
    perFileLines.push({ file, lines });
    totalCodeLines += lines.length;
    for (let i = 0; i + minLines <= lines.length; i += 1) {
      const slice = lines.slice(i, i + minLines);
      const normHash = hash(slice.map((l) => l.norm).join('\n'));
      const rawHash = hash(slice.map((l) => l.raw).join('\n'));
      if (!windows.has(normHash)) windows.set(normHash, []);
      windows.get(normHash).push({ file, startLine: slice[0].n, endLine: slice[slice.length - 1].n, rawHash });
    }
  }

  const clusters = [];
  const dupLineKeys = new Set(); // `${file}:${line}`
  for (const occ of windows.values()) {
    if (occ.length < 2) continue;
    const kind = occ.every((o) => o.rawHash === occ[0].rawHash) ? 'exact' : 'near';
    clusters.push({
      lines: minLines,
      kind,
      occurrences: occ.map(({ file, startLine, endLine }) => ({ file, startLine, endLine })),
    });
    for (const o of occ) {
      for (let n = o.startLine; n <= o.endLine; n += 1) dupLineKeys.add(`${o.file}:${n}`);
    }
  }

  clusters.sort((a, b) => b.occurrences.length - a.occurrences.length);
  const percentage = totalCodeLines === 0 ? 0 : Number(((dupLineKeys.size / totalCodeLines) * 100).toFixed(2));
  return { percentage, clusters };
}
