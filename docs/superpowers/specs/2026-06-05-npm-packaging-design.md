# Packaging Design: `@ma/roto-rooter`

## Goal

Make this repository a publishable npm package distributed via **JFrog Artifactory**
(primary target). Publishing is performed **manually** by a maintainer running
`npm publish` locally. The same package config remains compatible with a plain npm
registry if the registry URL is swapped.

## Decisions (locked)

- **Registry target:** JFrog Artifactory (primary).
- **Package name:** `@ma/roto-rooter` (scoped; scope `@ma` maps to the Artifactory npm repo).
- **CLI command:** `roto-rooter` (e.g. `roto-rooter <dir>`).
- **Publish method:** manual `npm publish` run locally by a maintainer.
- **Author:** Michael Rotoloni.
- **License:** ISC (matches current `package.json`).
- **Artifactory host / repo name:** unknown at design time — use documented placeholders
  (`<artifactory-host>`, `<npm-repo>`) that a human fills in before first publish.

## Components

### 1. `package.json`

| Field | New value |
|-------|-----------|
| `name` | `@ma/roto-rooter` |
| `version` | `1.0.0` (unchanged) |
| `description` | "A CLI that analyzes a JS/TS codebase and reports on its quality." |
| `bin` | `{ "roto-rooter": "src/cli.js" }` |
| `engines` | `{ "node": ">=24" }` |
| `files` | `["src", "RESEARCH.md"]` |
| `author` | `Michael Rotoloni` |
| `license` | `ISC` (unchanged) |
| `keywords` | `["code-quality", "static-analysis", "cli", "scanner", "metrics"]` |
| `repository` | `{ "type": "git", "url": "git+https://github.com/moodyroto/roto-rooter-code-scanner.git" }` |
| `bugs` | `{ "url": "https://github.com/moodyroto/roto-rooter-code-scanner/issues" }` |
| `homepage` | `https://github.com/moodyroto/roto-rooter-code-scanner#readme` |
| `publishConfig` | `{ "@ma:registry": "https://<artifactory-host>/artifactory/api/npm/<npm-repo>/" }` |
| `scripts.prepublishOnly` | `"npm test"` |

Existing `scripts.test` (`node --test`) and `scripts.scan` are kept. `main`
(`src/index.js`) and `type: "module"` are unchanged.

**Rationale for `files` allowlist:** an allowlist is safer than `.npmignore` — anything
not listed is excluded by default, so `test/`, `scan-report/`, `docs/`, `.superpowers/`,
`.cursor/`, `.claude/` cannot leak into the tarball. `package.json`, `README.md`, and
`LICENSE` are always included by npm regardless of the allowlist.

### 2. `.npmrc` (committed to repo root)

```
@ma:registry=https://<artifactory-host>/artifactory/api/npm/<npm-repo>/
//<artifactory-host>/artifactory/api/npm/<npm-repo>/:_authToken=${NPM_AUTH_TOKEN}
```

- Routes `@ma`-scoped installs/publishes to Artifactory.
- Auth token comes **only** from the `NPM_AUTH_TOKEN` environment variable. No secret is
  ever committed.
- Placeholders `<artifactory-host>` and `<npm-repo>` must be replaced before first publish.

### 3. `LICENSE`

ISC license text, copyright "Michael Rotoloni", current year.

### 4. Manual publish flow (documented, no CI)

Publishing is done by a maintainer from a clean checkout. The documented steps:

1. Replace the `<artifactory-host>` / `<npm-repo>` placeholders in `.npmrc` and
   `package.json#publishConfig` with the real Artifactory values (one-time).
2. Export an Artifactory auth token: `export NPM_AUTH_TOKEN=<token>` (the `.npmrc`
   reads it; never commit the token).
3. Bump `version` in `package.json`.
4. `npm publish --dry-run` to verify tarball contents (see Verification).
5. `npm publish` — `prepublishOnly` runs `npm test` first and aborts on failure.
6. Tag the release in git (`git tag vX.Y.Z && git push --tags`) for traceability.

No GitHub Actions workflow and no repo secrets are part of this design.

### 5. `README.md` updates

- Installation section: how to configure the `@ma` scope against Artifactory and
  `npm install -g @ma/roto-rooter`.
- Usage updated to `roto-rooter <dir> [options]` (replacing `node src/cli.js`).
- A short "Releasing" section documenting the manual publish flow above.

## Verification

During implementation, run `npm publish --dry-run` (or `npm pack --dry-run`) and confirm
the tarball contains only `src/`, `RESEARCH.md`, `README.md`, `LICENSE`, and
`package.json` — and excludes `test/`, `scan-report/`, `docs/`, and dotfolders. Run
`npm test` to confirm nothing broke.

## Out of scope

- Choosing/standing up the actual Artifactory instance (host/repo provided later).
- Any CI/CD automation — publishing is manual by decision.
- Publishing to the public npm registry (config is swap-compatible but not the target).
