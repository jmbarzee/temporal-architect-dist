# Publishing Rollout — Status, Architecture & Plan

Living capture of the work to bring every distribution channel from "wired in CI"
to "verified live on the public registry" **after the distribution-repo split**.
This is the source of truth for the current rollout; it supersedes the (now
pre-split, stale) status claims in [`publishing_setup.md`](./publishing_setup.md)
— keep that file for the PyPI/Homebrew account-creation *recipes*, which are still
accurate. Design rationale lives in [`packaging.md`](./packaging.md).

Last updated: 2026-06-17, during the first end-to-end test of the post-split
pipeline (toolchain `v0.9.0`).

---

## 1. Architecture (post-split)

Two repos, one release train:

```
jmbarzee/temporal-architect          (toolchain — engine + canonical Release)
  └─ tag v* → release.yml
       ├─ check-versions
       ├─ build-binaries (5 platforms) ─┐
       ├─ build-skills-tarball          ├─→ publish-github-release  (the canonical
       ├─ build-artifacts (vis + wire)  ┘     Release: all assets + SHA256SUMS)
       └─ dispatch-dist ──────────────────────► repository_dispatch (toolchain-release)
                                                        │  needs DIST_DISPATCH_TOKEN
                                                        ▼
jmbarzee/temporal-architect-dist     (storefront — downloads assets, republishes)
  └─ Consume Release (_consume-release.yml)
       ├─ resolve-version
       ├─ check-versions (stamp + verify)
       ├─ publish-npm-wire-types
       ├─ publish-npm-visualizer
       ├─ publish-npm-twf (5 sub-pkgs → wrapper)
       ├─ publish-npm-claude-plugin
       ├─ publish-pypi (5 wheels → upload)
       ├─ publish-vsix (build matrix → Open VSX + VS Code Marketplace)
       └─ publish-brew
```

- The toolchain is a **pure release-cutter**: it builds primitive artifacts and
  publishes the GitHub Release, then hands off. It holds **no** registry tokens.
- The dist repo holds **all** registry tokens and does **no** source build — it
  downloads the Release assets (`make fetch-release`), stamps the dispatched
  version into every manifest (`make stamp-versions`), repackages, and publishes.
- Dist never tags independently; the version is whatever the dispatch payload
  carries.

### Asset contract (toolchain Release → dist downloads)

Verified byte-for-byte locally against the dist `Makefile`:

| Asset | Consumed by |
|---|---|
| `twf-v<V>-{darwin,linux}-{amd64,arm64}.tar.gz`, `twf-v<V>-windows-amd64.zip` | npm-twf sub-pkgs, pypi wheels, VSIX binary |
| `skills-v<V>.tar.gz` | claude-plugin, VSIX |
| `visualizer-webview-v<V>.tar.gz` | VSIX webview |
| `temporal-architect-visualizer-<V>.tgz` | npm visualizer (republished) |
| `temporal-architect-wire-types-<V>.tgz` | npm wire-types (republished) **+ VSIX build (types)** |
| `SHA256SUMS` | integrity |

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
> cross-channel edge; it has been removed (see § 4).

---

## 2. The DIST_DISPATCH_TOKEN (toolchain → dist handoff)

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

## 3. First end-to-end test (toolchain `v0.9.0`)

Cut `v0.9.0` (minor, per AGENTS.md — the distribution split is a breaking change)
to exercise the new pipeline.

**Toolchain side — ✅ fully green.** `check-versions`, all 5 `build-binaries`,
`build-skills-tarball`, `build-artifacts`, and `publish-github-release` succeeded;
the GitHub Release shipped all 9 expected assets with correct names. Only
`dispatch-dist` failed initially (missing `DIST_DISPATCH_TOKEN`); fixed and the
re-run dispatched successfully.

**Dist side — diagnosed; plumbing works, publishes fail on secrets + 2 real bugs.**
`resolve-version`, `check-versions`, and the 5 `pypi` wheel **builds** all
succeeded. Publish jobs failed as follows:

| Channel | Failure observed | Root cause | Class |
|---|---|---|---|
| npm wire-types | `git ls-remote ssh://git@github.com/dist-assets/...tgz.git` → Permission denied | `npm publish dist-assets/x.tgz` read as a GitHub `owner/repo` shorthand | **bug (fixed)** |
| npm visualizer | same git-shorthand error | same | **bug (fixed)** |
| npm twf (sub-pkgs) | `ENEEDAUTH` | `NPM_TOKEN` missing | secret |
| npm claude-plugin | `ENEEDAUTH` | `NPM_TOKEN` missing | secret |
| PyPI publish | `TWINE_PASSWORD not set` | `PYPI_TOKEN` missing | secret |
| Homebrew | `HOMEBREW_TAP_TOKEN not set` | secret missing (+ tap repo) | secret |
| VSIX build | `npm 404 @temporal-architect/wire-types@0.9.0` | build pulled wire-types from npm before it was published | **bug (fixed via decouple)** |
| Open VSX | (never reached — build failed first) | depends on VSIX build | unknown token |
| VS Code Marketplace | (never reached — build failed first) | depends on VSIX build | unknown token |

---

## 4. Changes made in this work (dist repo)

Three coherent edits (committed together):

1. **`./`-prefix local tarball publishes** (`Makefile` `publish-visualizer`,
   `publish-wire-types`). `npm publish ./dist-assets/x.tgz` so npm treats the
   path as a local file instead of a `github.com/owner/repo` shorthand.
2. **Decouple the VSIX build from npm** (`Makefile` `stamp-versions`). The
   extension's `@temporal-architect/wire-types` devDependency is now stamped to
   `file:../../dist-assets/temporal-architect-wire-types-<V>.tgz` — the same
   Release tarball, consumed locally — so the VSIX builds with **zero** npm
   round-trips (mirrors how the webview bundle is already staged from a Release
   asset). Verified locally: `npm install` resolves wire-types from the tarball
   and `tsc` compiles the extension clean.
3. **Drop the ordering edge** (`_consume-release.yml` `publish-vsix`). Reverted
   the `needs: publish-npm-wire-types` added earlier — unnecessary (and harmful:
   it would skip the VSIX channels if the npm publish failed) now that the build
   is decoupled.

### Why decouple (decision record)

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

## 5. Remaining work — secrets (on `jmbarzee/temporal-architect-dist`)

Every non-bug failure is a missing secret. After the split, secrets must be
re-added to the **dist** repo (they previously lived on the toolchain). Store each
yourself (`gh secret set <NAME> -R jmbarzee/temporal-architect-dist`) so tokens
stay out of chat/logs.

| Secret | For | Status (from `v0.9.0`) | Notes |
|---|---|---|---|
| `OVSX_TOKEN` | Open VSX | missing on dist (exists on toolchain) | **Account side already done**: namespace `jmbarzee` is `verified` and `jmbarzee/twf-syntax` already shipped through `0.8.4` (pre-split). Eclipse agreement + namespace already exist — the *only* task is putting a valid token secret on the dist repo. **Doing first.** |
| `VSCE_TOKEN` | VS Code Marketplace | missing on dist (exists on toolchain) | Likewise already proven (Marketplace shipped through `0.8.4` pre-split). Azure DevOps PAT, scope Marketplace→Manage. **Second.** |
| `NPM_TOKEN` | wire-types, visualizer, twf, claude-plugin | **missing** (ENEEDAUTH) | npm Automation token; `@temporal-architect` scope publish rights. |
| `PYPI_TOKEN` | PyPI `twf-cli` | **missing** | See `publishing_setup.md § 1` for name-reservation recipe. |
| `HOMEBREW_TAP_TOKEN` | Homebrew tap | **missing** | Needs `jmbarzee/homebrew-twf` repo; fine-grained PAT Contents:RW. |

---

## 6. Plan / sequencing

Channels are independent, so we hook them up one at a time; a missing token only
fails its own channel. Chosen order: **Open VSX → VS Code Marketplace → the rest
(any order).**

1. **Push the § 4 changes** to dist `main` (must land before the next consume run
   uses them).
2. **Open VSX:** account side is *already done* — namespace `jmbarzee` is verified
   and `jmbarzee/twf-syntax` shipped through `0.8.4` pre-split (so the Eclipse
   agreement + namespace already exist). Only task: sign in to open-vsx.org
   (GitHub) → Settings → Access Tokens → generate a token → `gh secret set
   OVSX_TOKEN -R jmbarzee/temporal-architect-dist`. (Verification of this channel
   on `v0.9.0` is gated on the § 4 decouple fix being live on dist `main`, since
   `open-vsx` `needs: build` and that build 404s on wire-types until then.)
3. **VS Code Marketplace:** Azure DevOps PAT (org: all accessible, scope
   Marketplace→Manage) → `gh secret set VSCE_TOKEN ...`.
4. **npm / PyPI / Homebrew:** add their secrets (PyPI + Homebrew also need
   external account/repo setup — see `publishing_setup.md § 1`).
5. **Re-run** dist **Consume Release** (`workflow_dispatch`, version `v0.9.0` —
   nothing published successfully, so the version is clean to retry) after each
   secret lands; verify that channel, then move to the next.
6. **Per-channel smoke tests:** see `publishing_setup.md § 3` (registry resolution
   path, not just CI green).

### How to re-run the dist consume for an existing Release

```bash
gh workflow run "Consume Release" -R jmbarzee/temporal-architect-dist -f version=v0.9.0
```
(The Release already exists, so this exercises the full download→stamp→publish
path without re-tagging the toolchain.)
