const TEST_FILENAME = /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const TEST_DIRS = new Set(['__tests__', '__mocks__']);

export function isTestFile(relPath) {
  const parts = String(relPath).split(/[\\/]/);
  if (parts.some((p) => TEST_DIRS.has(p))) return true; // any segment is a test dir
  return TEST_FILENAME.test(parts[parts.length - 1]);    // filename infix
}
