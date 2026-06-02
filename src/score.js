const SEVERITY_MULT = { high: 1.0, medium: 0.6, low: 0.3 };

function gradeFor(value) {
  if (value >= 90) return 'A';
  if (value >= 80) return 'B';
  if (value >= 70) return 'C';
  if (value >= 60) return 'D';
  return 'F';
}

export function scoreResult({ complexity, secrets }) {
  const secretsPenalty = -(secrets.findings.reduce((sum, f) => sum + 15 * (SEVERITY_MULT[f.severity] ?? 0.3), 0));
  const complexityPenalty = -(complexity.flagged.reduce((sum, f) => sum + (f.band === 'high-risk' ? 8 : 3), 0));
  const breakdown = {
    secrets: Number(secretsPenalty.toFixed(2)),
    complexity: Number(complexityPenalty.toFixed(2)),
  };
  const raw = 100 + breakdown.secrets + breakdown.complexity;
  const value = Math.max(0, Math.min(100, Math.round(raw)));
  return { value, grade: gradeFor(value), breakdown };
}
