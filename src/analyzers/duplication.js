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

// Signature of a window-class: its sorted (file, startIdx) set, optionally shifted by d.
// startIdx is the CODE-LINE INDEX (position in normalizeLines output), which is always
// contiguous — so chaining is correct even when source lines have blank-line gaps.
function sigOf(occ, d = 0) {
  return JSON.stringify(occ.map((o) => [o.file, o.startIdx + d]));
}

export function findDuplication(fileEntries, { minLines = 5 } = {}) {
  const fileLines = new Map();    // file -> normalizeLines output (code lines with .n)
  const contentLines = new Map(); // file -> original source lines
  let totalCodeLines = 0;

  // normHash -> Map<file, number[] of start code-line indices (ascending)>
  const hashToFileStarts = new Map();

  for (const { file, content, tokens } of fileEntries) {
    const lines = normalizeLines(content, tokens);
    fileLines.set(file, lines);
    contentLines.set(file, content.split('\n'));
    totalCodeLines += lines.length;
    for (let i = 0; i + minLines <= lines.length; i += 1) {
      const slice = lines.slice(i, i + minLines);
      const normHash = hash(slice.map((l) => l.norm).join('\n'));
      if (!hashToFileStarts.has(normHash)) hashToFileStarts.set(normHash, new Map());
      const byFile = hashToFileStarts.get(normHash);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(i); // store the code-line INDEX, not the source line number
    }
  }

  // Positional pairing across files: one occurrence per file per window-class, keyed by
  // its sorted (file, startIdx) signature. (v1 limitation: only cross-file duplication is
  // reported — a block duplicated within a single file, and asymmetric repeat counts where
  // the same window recurs unequally across files, are out of scope.)
  const classBySig = new Map(); // sig -> [{ file, startIdx }]
  for (const byFile of hashToFileStarts.values()) {
    if (byFile.size < 2) continue;
    const entries = [...byFile.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const minCount = Math.min(...entries.map(([, starts]) => starts.length));
    for (let idx = 0; idx < minCount; idx += 1) {
      const occ = entries.map(([file, starts]) => ({ file, startIdx: starts[idx] }));
      classBySig.set(sigOf(occ), occ);
    }
  }

  // Merge consecutive classes (each step shifts every startIdx by +1) into maximal blocks.
  const blocks = [];
  const dupCodeLines = new Set(); // `${file}:${codeLineIndex}` — counts duplicated CODE lines only
  for (const headOcc of classBySig.values()) {
    if (classBySig.has(sigOf(headOcc, -1))) continue; // only start from a chain head
    let lastOcc = headOcc;
    while (classBySig.has(sigOf(lastOcc, 1))) {
      lastOcc = classBySig.get(sigOf(lastOcc, 1));
    }
    const occurrences = headOcc.map((h, k) => {
      const lines = fileLines.get(h.file);
      const endIdx = lastOcc[k].startIdx + minLines - 1; // last code line of the tail window
      for (let idx = h.startIdx; idx <= endIdx; idx += 1) dupCodeLines.add(`${h.file}:${idx}`);
      return { file: h.file, startLine: lines[h.startIdx].n, endLine: lines[endIdx].n };
    });
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

  const percentage = totalCodeLines === 0 ? 0 : Number(((dupCodeLines.size / totalCodeLines) * 100).toFixed(2));

  return { percentage, clusters };
}
