const SEVERITY_MULT = { high: 1.0, medium: 0.6, low: 0.3 };
const BUDGET = { security: 40, complexity: 20, dependencies: 15, coverage: 25 };

function gradeFor(value) {
  if (value >= 90) return 'A';
  if (value >= 80) return 'B';
  if (value >= 70) return 'C';
  if (value >= 60) return 'D';
  return 'F';
}

export function scoreResult({ complexity, security, dependencies = { cycles: [] }, coverage = { ratio: 1 } }) {
  const securityRaw = security.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0);
  const complexityRaw = complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0);
  const dependenciesRaw = 8 * dependencies.cycles.length;
  const coverageRaw = Math.round(25 * (1 - coverage.ratio));

  const breakdown = {
    security: Number((-Math.min(BUDGET.security, securityRaw)).toFixed(2)),
    complexity: Number((-Math.min(BUDGET.complexity, complexityRaw)).toFixed(2)),
    dependencies: Number((-Math.min(BUDGET.dependencies, dependenciesRaw)).toFixed(2)),
    coverage: Number((-Math.min(BUDGET.coverage, coverageRaw)).toFixed(2)),
  };
  const raw = 100 + breakdown.security + breakdown.complexity + breakdown.dependencies + breakdown.coverage;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
