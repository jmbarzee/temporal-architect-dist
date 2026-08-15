# Release Pipeline (post-split)

How a toolchain release becomes published artifacts on every channel, and why the
pipeline is shaped this way. Channel design and conventions live in
[`packaging.md`](./packaging.md); the PyPI / Homebrew account-creation recipes live in
[`publishing_setup.md`](./publishing_setup.md).

---

## Architecture

Two repos, one release train:

```
jmbarzee/temporal-architect          (toolchain — engine, libraries, canonical Release)
  └─ tag v* → release.yml
       ├─ check-versions
       ├─ build-binaries (5 platforms) ─┐
       ├─ build-skills-tarball          ├─→ publish-github-release  (the canonical
       ├─ build-artifacts (vis + wire)  ┘     Release: all assets + SHA256SUMS)
       ├─ publish-npm-libs ──────────────────► npm: visualizer + wire-types (OIDC + provenance)
       └─ dispatch-dist ──────────────────────► repository_dispatch (toolchain-release)
                                                        │  needs DIST_DISPATCH_TOKEN
                                                        ▼
jmbarzee/temporal-architect-dist     (storefront — downloads assets, packages consumption models)
  └─ Consume Release (_consume-release.yml)
       ├─ resolve-version
       ├─ check-versions (stamp + verify)
       ├─ publish-npm-twf (5 sub-pkgs → wrapper)
       ├─ publish-npm-claude-plugin
       ├─ publish-pypi (5 wheels → upload)
       ├─ publish-vsix (build matrix; builds webview from visualizer lib → Open VSX + VS Code Marketplace)
       └─ publish-brew
```

- The toolchain builds primitive artifacts, **publishes its own two npm libraries**
  (visualizer + wire-types, via OIDC — no token), publishes the GitHub Release, then
  hands off. It holds only `GITHUB_TOKEN` + `DIST_DISPATCH_TOKEN`.
- The dist repo holds the **consumption-model** registry tokens and does no *source*
  build (it does build the webview bundle from the visualizer library) — it downloads
  the Release assets (`make fetch-release`), stamps the dispatched version into every
  manifest (`make stamp-versions`), packages, and publishes.
- Dist never tags independently; the version is whatever the dispatch payload
  carries.

### Asset contract (toolchain Release → dist downloads)

Verified byte-for-byte locally against the dist `Makefile`:

| Asset | Consumed by |
|---|---|
| `twf-v<V>-{darwin,linux}-{amd64,arm64}.tar.gz`, `twf-v<V>-windows-amd64.zip` | npm-twf sub-pkgs, pypi wheels, VSIX binary |
| `skills-v<V>.tar.gz` | claude-plugin, VSIX |
| `temporal-architect-visualizer-<V>.tgz` | VSIX webview build (`file:`, via `packages/webview`). *(npm publish of this package happens in the toolchain, not here.)* |
| `temporal-architect-wire-types-<V>.tgz` | VSIX build types (`file:`). *(npm publish happens in the toolchain.)* |
| `SHA256SUMS` | integrity |

> The `visualizer-webview-v<V>.tar.gz` asset is gone: the webview IIFE bundle is now
> built in this repo (`packages/webview`) from the visualizer library tarball.

### Dependency graph (what blocks what)

Everything depends on the toolchain Release (always satisfied before dispatch).
After the decouple change below, **there are no cross-channel dependencies** —
every channel needs only its own token + the Release. Internal-only ordering:

- npm-twf: 5 platform sub-packages publish **before** the wrapper (the wrapper's
  `optionalDependencies` must resolve to already-published versions).
- VSIX: per-platform build matrix runs **before** Open VSX / Marketplace publish;
  those two registries are independent (one failing never blocks the other).

> Historical note: before the decouple, the VSIX build `npm install`ed the
> *published* `@temporal-architect/wire-types`, so Open VSX + Marketplace
> transitively depended on a successful npm wire-types publish. That was the only
> cross-channel edge; it has been removed (see the section above.

---

## The DIST_DISPATCH_TOKEN (toolchain → dist handoff)

The `dispatch-dist` job uses `peter-evans/repository-dispatch`, which needs a PAT
with write access to the **target** (dist) repo — `GITHUB_TOKEN` only works
in-repo.

- **Type:** fine-grained PAT, resource owner `jmbarzee`, repository access = only
  `jmbarzee/temporal-architect-dist`, permission **Contents: Read and write**
  (Metadata: read auto-added).
- **Stored as:** `DIST_DISPATCH_TOKEN` secret on the **toolchain** repo
  (`jmbarzee/temporal-architect`).
- **Status:** ✅ created and working (verified by the `v0.9.0` re-run firing the
  dist `Consume Release`).

---

## Why the VSIX build is decoupled from npm

The extension only needs wire-types for **compile-time types** (devDependency);
the runtime visualizer arrives as a prebuilt webview bundle, not via npm. The
wire-types tarball is *already downloaded* from the Release, so consuming it
locally makes the build consistent and lets Open VSX / Marketplace ship
independently of npm.

**Downsides considered & accepted:**
- Lose the implicit "wire-types is actually installable from npm" cross-check
  (each channel still reports independently).
- A `file:` path appears in the VSIX's packaged `package.json` — cosmetic only;
  devDependencies are never installed by extension users. (Chose the `file:` ref
  over `npm install --no-save` to keep the dependency *documented*.)
- Building the extension from source now requires `make fetch-release` first
  (already effectively true — it also needs the staged webview/skills/binary).
- Ruled out as non-issues: content drift (npm pkg *is* the tarball), end-user
  impact (compile-time only), lockfile churn (no committed lockfile).

---

## Re-running a consume for an existing Release

```bash
gh workflow run "Consume Release" -R jmbarzee/temporal-architect-dist -f version=v<VERSION>
```
(The Release must already exist; this exercises the full download→stamp→publish
path without re-tagging the toolchain.)
