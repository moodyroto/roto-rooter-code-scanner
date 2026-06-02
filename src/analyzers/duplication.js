import crypto from 'node:crypto';

const SNIPPET_MAX = 20;

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
  // normHash -> { file -> [startLine, ...] } (sorted ascending)
  const hashToFileStarts = new Map();
  const contentLines = new Map(); // file -> original source lines
  let totalCodeLines = 0;

  for (const { file, content, tokens } of fileEntries) {
    const lines = normalizeLines(content, tokens);
    contentLines.set(file, content.split('\n'));
    totalCodeLines += lines.length;
    for (let i = 0; i + minLines <= lines.length; i += 1) {
      const slice = lines.slice(i, i + minLines);
      const normHash = hash(slice.map((l) => l.norm).join('\n'));
      if (!hashToFileStarts.has(normHash)) hashToFileStarts.set(normHash, new Map());
      const byFile = hashToFileStarts.get(normHash);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(slice[0].n);
    }
  }

  // Build window-classes: for each normHash that appears in >=2 files,
  // pair up occurrences positionally (sorted within each file) to form
  // individual window-classes, each with exactly one occurrence per file.
  //
  // When a hash appears N times in file A and M times in file B,
  // we pair min(N,M) times (positional pairing). Each pair is one window-class.
  //
  // endLine = startLine + minLines - 1 (approximation; actual line numbers from normalizeLines
  // are 1-based and contiguous so endLine = startLine + minLines - 1).
  //
  // We key each window-class by its sorted (file, startLine) signature for chain merging.

  const classBySig = new Map(); // sig -> [{ file, startLine, endLine }]

  for (const byFile of hashToFileStarts.values()) {
    if (byFile.size < 2) continue;
    const fileEntries2 = [...byFile.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    // Find the minimum count across all files
    const minCount = Math.min(...fileEntries2.map(([, starts]) => starts.length));
    // Pair positionally: for each index 0..minCount-1, create one window-class
    for (let idx = 0; idx < minCount; idx += 1) {
      const occurrences = fileEntries2.map(([file, starts]) => ({
        file,
        startLine: starts[idx],
        endLine: starts[idx] + minLines - 1,
      }));
      const sig = JSON.stringify(occurrences.map((o) => [o.file, o.startLine]));
      classBySig.set(sig, occurrences);
    }
  }

  // Helper: shift all startLines by d and recompute sig
  function shiftedSig(occ, d) {
    return JSON.stringify(occ.map((o) => [o.file, o.startLine + d]));
  }

  // Merge consecutive classes (each step shifts every start by +1) into maximal blocks.
  const blocks = [];
  for (const [, headOcc] of classBySig) {
    if (classBySig.has(shiftedSig(headOcc, -1))) continue; // only start from a chain head
    let lastOcc = headOcc;
    while (classBySig.has(shiftedSig(lastOcc, 1))) {
      lastOcc = classBySig.get(shiftedSig(lastOcc, 1));
    }
    const occurrences = headOcc.map((h, idx) => ({
      file: h.file,
      startLine: h.startLine,
      endLine: lastOcc[idx].endLine,
    }));
    blocks.push(occurrences);
  }

  const clusters = blocks.map((occurrences) => {
    const snippets = occurrences.map((o) =>
      (contentLines.get(o.file) ?? []).slice(o.startLine - 1, o.endLine).join('\n'));
    const kind = snippets.every((s) => s === snippets[0]) ? 'exact' : 'near';
    const lines = occurrences[0].endLine - occurrences[0].startLine + 1;
    const srcLines = snippets[0].split('\n');
    const snippet = srcLines.slice(0, SNIPPET_MAX).join('\n');
    const snippetOmitted = Math.max(0, lines - SNIPPET_MAX);
    return { lines, kind, occurrences, snippet, snippetOmitted };
  });

  clusters.sort((a, b) => (b.lines * b.occurrences.length) - (a.lines * a.occurrences.length));

  const dupLineKeys = new Set();
  for (const c of clusters) {
    for (const o of c.occurrences) {
      for (let n = o.startLine; n <= o.endLine; n += 1) dupLineKeys.add(`${o.file}:${n}`);
    }
  }
  const percentage = totalCodeLines === 0 ? 0 : Number(((dupLineKeys.size / totalCodeLines) * 100).toFixed(2));

  return { percentage, clusters };
}
