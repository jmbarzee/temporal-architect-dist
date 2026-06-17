# temporal-architect-dist

**Distribution / storefront for [temporal-architect](https://github.com/jmbarzee/temporal-architect).**

This repo contains no engine source. It **consumes** the toolchain repo's GitHub
Release assets and **publishes** every shippable package. The toolchain is the
engine + the canonical Release; this is packaging.

## How it works

On each `v*` tag, the toolchain repo cuts a GitHub Release (per-platform `twf`
binaries, `skills-vX.Y.Z.tar.gz`, the visualizer lib + webview bundle, the
`@temporal-architect/wire-types` tarball, `SHA256SUMS`) and fires a
`repository_dispatch` (`toolchain-release`, payload `{version}`) at this repo.

The curl-bash installer [`packages/install.sh`](packages/install.sh) lives here and
is served via raw URL
(`https://raw.githubusercontent.com/jmbarzee/temporal-architect-dist/main/packages/install.sh`);
it downloads the platform binary from the toolchain Release.

[`_consume-release.yml`](.github/workflows/_consume-release.yml) then downloads
those assets, stamps the version into every manifest, repackages, and publishes:

| Package | How |
|---|---|
| VSIX (VS Code Marketplace + Open VSX) | build extension from downloaded binary + webview + skills |
| `@temporal-architect/twf` + 5 platform sub-packages | stage downloaded binaries, `npm publish` |
| `twf-cli` (PyPI, 5 wheels) | stage downloaded binaries, build + `twine upload` |
| `@temporal-architect/visualizer` | re-publish the downloaded lib tarball |
| `@temporal-architect/wire-types` | re-publish the downloaded tarball |
| `@temporal-architect/claude-plugin` + `.claude-plugin/marketplace.json` | stage downloaded skills, `npm publish` |
| Homebrew `jmbarzee/homebrew-twf` | `bump-brew` pins the toolchain Release URLs/SHAs |

No source build happens here — `make` downloads, stages, and repackages. See the
[`Makefile`](Makefile) targets.

## Versioning

This repo never tags independently. The version is the one carried in the
dispatch payload (the toolchain tag). `make stamp-versions VERSION=X.Y.Z` writes
it into every manifest at build time; `make check-versions` verifies it took.

## Required secrets

| Secret | Used by |
|---|---|
| `VSCE_TOKEN` | VS Code Marketplace publish |
| `OVSX_TOKEN` | Open VSX publish |
| `NPM_TOKEN` | npm (twf, visualizer, wire-types, claude-plugin) |
| `PYPI_TOKEN` | PyPI |
| `HOMEBREW_TAP_TOKEN` | Homebrew tap bump |

The toolchain repo holds only `GITHUB_TOKEN` + `DIST_DISPATCH_TOKEN` (the PAT it
uses to dispatch here).

## Manual re-run

Use the **Run workflow** button on *Consume Release* (`workflow_dispatch`) with a
version (e.g. `v0.3.2`) to re-publish — useful if a single channel failed.

## Registry identifiers

Unchanged by the repo split: npm scope `@temporal-architect`, PyPI `twf-cli`,
VSIX id `jmbarzee.twf-syntax`. Manifests set `homepage` → the toolchain repo (the
front door) and `repository` → this repo (where each package's source lives).
