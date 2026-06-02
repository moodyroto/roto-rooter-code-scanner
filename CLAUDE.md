# CLAUDE.md

## What this is
A CLI code scanner that analyzes any codebase and reports on its quality. Written in node v24 using strict standards.

The scope is intentionally ambitious — the solution is DPI, not working harder. Design before building. Plan before implementing. Let the agent iterate while you steer.

## Core Requirements
* Accept a directory path via CLI
* Recursively traverse files (with sensible ignore patterns)
* Detect languages by file type
* Extract basic metrics: lines of code, comments, blanks, file counts
* Count functions and classes
* Include 2–3 analysis features picked from the Analysis Feature Menu below
* Output structured JSON results
* Generate one human-readable report in Markdown

## Stretch Goals
* Quality scoring system (0–100, letter grade) — if not already in your core picks
* Data visualizations (charts/graphs in an HTML report)
* Unit tests for critical scanner paths
* RESEARCH.md documenting your architecture decisions
* Model strategy applied (strongest model for planning, fastest for implementation)
* Parallel implementations via worktrees — compare two approaches side-by-side
* Custom command encoding a reusable workflow from the build
* Created or extended a Skill that helps with the build