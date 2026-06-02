import path from 'node:path';

export const LANGUAGE_BY_EXT = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.json': 'JSON', '.md': 'Markdown', '.css': 'CSS', '.html': 'HTML', '.yml': 'YAML', '.yaml': 'YAML',
};

const JS_TS = new Set(['JavaScript', 'TypeScript']);

export function detectLanguage(filePath) {
  return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] ?? null;
}

export function isJsTs(filePath) {
  return JS_TS.has(detectLanguage(filePath));
}
