#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { scan } from './scanner.js';
import { toJson } from './report/json.js';
import { toMarkdown } from './report/markdown.js';
import { toHtml } from './report/html.js';

export function parseArgs(argv) {
  const args = { directory: null, out: 'scan-report', formats: ['json', 'md', 'html'], threshold: 10, ignore: [], gitignore: true, includeTests: false };
  const valueFor = (flag, i) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') { args.out = valueFor(a, i); i += 1; }
    else if (a === '--format') { args.formats = valueFor(a, i).split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (a === '--threshold') {
      const raw = valueFor(a, i); i += 1;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`--threshold must be a number, got "${raw}"`);
      args.threshold = n;
    }
    else if (a === '--ignore') { args.ignore.push(valueFor(a, i)); i += 1; }
    else if (a === '--no-gitignore') args.gitignore = false;
    else if (a === '--include-tests') args.includeTests = true;
    else if (a === '--help') args.help = true;
    else if (!a.startsWith('--') && args.directory === null) args.directory = a;
  }
  return args;
}

const HELP = `Usage: code-scanner <directory> [--out dir] [--format json,md,html] [--threshold n] [--ignore name] [--no-gitignore] [--include-tests]`;

export async function main(argv) {
  let args;
  try { args = parseArgs(argv); }
  catch (err) { console.error(`Error: ${err.message}\n${HELP}`); return 1; }
  if (args.help) { console.log(HELP); return 0; }
  if (!args.directory) { console.error('Error: directory path is required\n' + HELP); return 1; }
  if (!fs.existsSync(args.directory) || !fs.statSync(args.directory).isDirectory()) {
    console.error(`Error: not a directory: ${args.directory}`); return 1;
  }

  const result = scan(args.directory, { threshold: args.threshold, ignore: args.ignore, gitignore: args.gitignore, includeTests: args.includeTests });
  fs.mkdirSync(args.out, { recursive: true });
  if (args.formats.includes('json')) fs.writeFileSync(path.join(args.out, 'report.json'), toJson(result));
  if (args.formats.includes('md')) fs.writeFileSync(path.join(args.out, 'report.md'), toMarkdown(result));
  if (args.formats.includes('html')) fs.writeFileSync(path.join(args.out, 'report.html'), toHtml(result));

  console.log(`Scanned ${result.summary.totalFiles} files — score ${result.score.value}/100 (${result.score.grade}). Reports in ${args.out}/`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
