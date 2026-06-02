import fs from 'node:fs';
import path from 'node:path';
import { loadGitignore, isIgnored } from './gitignore.js';

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.cursor', 'scan-report',
]);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.lock', '.woff', '.woff2']);

export function traverse(rootDir, { ignore = [], gitignore = true } = {}) {
  rootDir = path.resolve(rootDir);
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...ignore]);
  const matcher = gitignore ? loadGitignore(rootDir) : null;
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignoreSet.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (isIgnored(matcher, path.relative(rootDir, full))) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !BINARY_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}
