import _traverse from '@babel/traverse';
const traverse = _traverse.default ?? _traverse;

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);

export function bandFor(score) {
  if (score <= 10) return 'ok';
  if (score <= 20) return 'refactor';
  return 'high-risk';
}

function functionName(node) {
  if (node.id?.name) return node.id.name;
  if (node.key?.name) return node.key.name;
  return '<anonymous>';
}

function complexityOf(fnPath) {
  let score = 1;
  fnPath.traverse({
    'IfStatement|ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement|SwitchCase|CatchClause|ConditionalExpression'(p) {
      if (p.isSwitchCase() && p.node.test === null) return; // default case adds nothing
      score += 1;
    },
    LogicalExpression(p) {
      if (p.node.operator === '&&' || p.node.operator === '||' || p.node.operator === '??') score += 1;
    },
  });
  return score;
}

export function fileComplexity(ast) {
  const functions = [];
  traverse(ast, {
    Function(path) {
      if (!FN_TYPES.has(path.node.type)) return;
      const score = complexityOf(path);
      functions.push({ name: functionName(path.node), line: path.node.loc.start.line, score, band: bandFor(score) });
    },
  });
  return { functions };
}
