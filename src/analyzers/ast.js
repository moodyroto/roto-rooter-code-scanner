import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default ?? _traverse;

export function parseFile(content, filePath) {
  try {
    const ast = parse(content, {
      sourceType: 'unambiguous',
      tokens: true,
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });
    return { ast, comments: ast.comments ?? [], tokens: ast.tokens ?? [] };
  } catch (err) {
    return { parseError: true, message: err.message };
  }
}

export function countDefinitions(ast) {
  let functions = 0, classes = 0;
  traverse(ast, {
    'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod'() {
      functions += 1;
    },
    'ClassDeclaration|ClassExpression'() { classes += 1; },
  });
  return { functions, classes };
}

export function commentLineNumbers(comments) {
  const set = new Set();
  for (const c of comments) {
    if (!c.loc) continue;
    for (let n = c.loc.start.line; n <= c.loc.end.line; n += 1) set.add(n);
  }
  return set;
}
