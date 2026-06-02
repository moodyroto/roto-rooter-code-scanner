import fs from 'node:fs';
import path from 'node:path';
import makeIgnore from 'ignore';

export function loadGitignore(rootDir) {
  const file = path.join(rootDir, '.gitignore');
  let content;
  try { content = fs.readFileSync(file, 'utf8'); }
  catch { return null; }
  return makeIgnore().add(content);
}

export function isIgnored(matcher, relPath) {
  if (!matcher) return false;
  const posix = relPath.split(path.sep).join('/');
  if (posix === '' || posix === '.') return false;
  return matcher.ignores(posix);
}
