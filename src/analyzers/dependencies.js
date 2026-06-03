import path from 'node:path';
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;

const EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];

export function extractImports(ast) {
  const specs = [];
  traverse(ast, {
    ImportDeclaration(p) { specs.push(p.node.source.value); },
    ExportNamedDeclaration(p) { if (p.node.source) specs.push(p.node.source.value); },
    ExportAllDeclaration(p) { specs.push(p.node.source.value); },
  });
  return specs;
}

export function resolveImport(importerAbs, specifier, fileSet) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const base = path.resolve(path.dirname(importerAbs), specifier);
  const candidates = [base];
  for (const ext of EXTS) candidates.push(base + ext);
  for (const ext of EXTS) candidates.push(path.join(base, `index${ext}`));
  for (const c of candidates) if (fileSet.has(c)) return c;
  return null;
}

export function analyzeDependencies(entries, fileSet) {
  const adj = new Map();      // file -> Set(target)
  const inDegree = new Map(); // file -> number of distinct importers
  let internalEdges = 0;
  let externalImports = 0;
  const selfImports = new Set();

  for (const f of fileSet) { adj.set(f, new Set()); inDegree.set(f, 0); }

  for (const { file, specifiers } of entries) {
    if (!adj.has(file)) adj.set(file, new Set());
    if (!inDegree.has(file)) inDegree.set(file, 0);
    for (const spec of specifiers) {
      const target = resolveImport(file, spec, fileSet);
      if (target === null) { externalImports += 1; continue; }
      internalEdges += 1;
      if (target === file) { selfImports.add(file); continue; }
      if (!adj.get(file).has(target)) {
        adj.get(file).add(target);
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }
  }

  // Tarjan's strongly connected components.
  let index = 0;
  const indices = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  const strongconnect = (v) => {
    indices.set(v, index); low.set(v, index); index += 1;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), indices.get(w))); }
    }
    if (low.get(v) === indices.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      sccs.push(comp);
    }
  };
  for (const v of adj.keys()) if (!indices.has(v)) strongconnect(v);

  const cycles = sccs.filter((c) => c.length >= 2).map((c) => ({ files: [...c].sort() }));
  for (const f of selfImports) cycles.push({ files: [f] });
  cycles.sort((a, b) => b.files.length - a.files.length);

  const mostImported = [...inDegree.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([file, importedBy]) => ({ file, importedBy }));

  return { cycles, summary: { modules: entries.length, internalEdges, externalImports }, mostImported };
}
