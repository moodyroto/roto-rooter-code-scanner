const TEST_INFIX = /^(.+)\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const JSTS_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;

// The source-module key ("<dir>::<stem>") a test file targets, or null if it is not a unit test.
export function testTargetKey(file) {
  const parts = file.split(/[\\/]/);
  const base = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  const m = base.match(TEST_INFIX);
  let stem;
  if (m) stem = m[1];
  else if (dirParts[dirParts.length - 1] === '__tests__') stem = base.replace(JSTS_EXT, '');
  else return null;
  const moduleDir = dirParts[dirParts.length - 1] === '__tests__' ? dirParts.slice(0, -1) : dirParts;
  return `${moduleDir.join('/')}::${stem}`;
}

// The key ("<dir>::<stem>") for a source module.
export function moduleKey(file) {
  const parts = file.split(/[\\/]/);
  const base = parts[parts.length - 1];
  return `${parts.slice(0, -1).join('/')}::${base.replace(JSTS_EXT, '')}`;
}

export function analyzeCoverage(sourceFiles, testFiles) {
  const targets = new Set();
  for (const t of testFiles) {
    const key = testTargetKey(t);
    if (key) targets.add(key);
  }
  const untested = [];
  let testedModules = 0;
  for (const f of sourceFiles) {
    if (targets.has(moduleKey(f))) testedModules += 1;
    else untested.push(f);
  }
  const totalModules = sourceFiles.length;
  const ratio = totalModules ? Number((testedModules / totalModules).toFixed(2)) : 1;
  return { totalModules, testedModules, ratio, untested };
}
