# Packaging Design: `@ma/roto-rooter`

## Goal

Make this repository a publishable npm package distributed via **JFrog Artifactory**
(primary target). Publishing happens automatically through a GitHub Actions workflow
when a GitHub Release is published. The same package config remains compatible with a
plain npm registry if the registry URL is swapped.

## Decisions (locked)

- **Registry target:** JFrog Artifactory (primary).
- **Package name:** `@ma/roto-rooter` (scoped; scope `@ma` maps to the Artifactory npm repo).
- **CLI command:** `roto-rooter` (e.g. `roto-rooter <dir>`).
- **Publish trigger:** GitHub Actions on `release: published`.
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

### 4. `.github/workflows/publish.yml`

- **Trigger:** `on: release: { types: [published] }`
- **Job steps:**
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with `node-version: 24`,
     `registry-url: https://<artifactory-host>/artifactory/api/npm/<npm-repo>/`,
     `scope: '@ma'` (this generates the runner `.npmrc` with the auth token).
  3. `npm ci`
  4. `npm test`
  5. **Version guard:** verify the release tag (`github.event.release.tag_name`, stripped
     of a leading `v`) equals the `version` in `package.json`; fail the job on mismatch.
  6. `npm publish`
- **Auth:** `NODE_AUTH_TOKEN: ${{ secrets.ARTIFACTORY_NPM_TOKEN }}` on the publish step.
  A human must create the `ARTIFACTORY_NPM_TOKEN` repo secret.

### 5. `README.md` updates

- Installation section: how to configure the `@ma` scope against Artifactory and
  `npm install -g @ma/roto-rooter`.
- Usage updated to `roto-rooter <dir> [options]` (replacing `node src/cli.js`).
- A short "Releasing" section: bump `package.json` version → create a matching GitHub
  Release (tag `vX.Y.Z`) → workflow publishes.

## Verification

During implementation, run `npm pack --dry-run` and confirm the tarball contains only
`src/`, `RESEARCH.md`, `README.md`, `LICENSE`, and `package.json` — and excludes `test/`,
`scan-report/`, `docs/`, and dotfolders. Run `npm test` to confirm nothing broke.

## Out of scope

- Choosing/standing up the actual Artifactory instance (host/repo provided later).
- Automated version bumping (release tag is created manually; workflow only guards it).
- Publishing to the public npm registry (config is swap-compatible but not the target).
