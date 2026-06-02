export function lineMetrics(content, commentLineSet = new Set()) {
  const lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // ignore trailing newline
  let blanks = 0, comments = 0, code = 0;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.trim() === '') blanks += 1;
    else if (commentLineSet.has(n)) comments += 1;
    else code += 1;
  });
  return { total: lines.length, code, comments, blanks };
}
