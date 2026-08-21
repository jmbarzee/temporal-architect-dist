# temporal-architect-dist

The **storefront** for the temporal-architect toolchain. This repo does **almost
no source build**: it downloads the toolchain's (`jmbarzee/temporal-architect`)
GitHub Release assets (binaries, skills tarball, visualizer lib, wire-types),
stamps the incoming version into every manifest, repackages, and publishes to
every registry (VS Code Marketplace / Open VSX, npm `@temporal-architect/twf` +
platform sub-packages, PyPI `twf-cli`, Claude plugin + marketplace catalog,
Homebrew). The toolchain owns the engine and the canonical Release and publishes
its own libraries (`visualizer`, `wire-types`); this repo publishes every
**end-user consumption model**. See `packaging.md` (channel design) and
`publishing_setup.md` (rollout state).

The **one exception** to "no source build" is **`twf-serve`** (`packages/twf-serve`):
dist-owned Go source that this repo cross-compiles. It is a live visualizer host —
a local HTTP server that imports the toolchain's `tools/lsp/pipeline` in-process
and embeds the `packages/serve-ui` single-file bundle. It is not a repackaged
toolchain binary, so it has its own build (Makefile `twf-serve-archives`), its own
dist GitHub Release + tag (which also backs `go install`), and its own Homebrew
formula (`twf-serve.rb`). See the "twf-serve" section below.

## Documentation is a first-class, composable component

Treat published documentation/descriptions like artifacts, not prose. Every
listing's copy is **composed**, not hand-authored per channel:

```
listing description = [per-target channel header] + [shared component fragments]
```

- **Canonical component fragments** (global vision, parser/`twf`, MCP,
  visualizer, skills) live in the **toolchain** repo and travel here **with their
  artifact** (npm libs carry their README in the tgz; the binary's pitch rides
  with the binary archive; skills ride in the skills tarball). dist composes each
  listing from the assets it already downloads via `make fetch-release`.
- **Per-target headers** (install method + packaging-format notes + "assemble the
  rest" cross-links) are the **only doc source tracked in this repo**.
- **Rendered package READMEs are generated build output** (gitignored). Do
  **not** hand-edit a generated listing to fix shared copy — edit the component
  fragment (in the toolchain) or the per-target header (here), then re-render.
- Short `description` fields are stamped from the same source.

The component → distribution map, the propagation matrix, and the open
publishing/doc gaps are maintained in **`documentation_propagation.md`**. When
adding a publishing channel or changing any listing copy, update that matrix and
keep channels in sync per their row — do not introduce a new hand-written pitch.

### How it works (the pipeline is live)

- Canonical fragments live in the toolchain (`docs/fragments/*.md`) and ship
  inside the artifacts they cover; `make stage-docs` extracts them from the
  downloaded Release assets into `dist-assets/docs/`.
- Per-target **header templates** live here in `docs/templates/*.md` and embed
  `{{fragment:global|parser|mcp|visualizer}}` and `{{skills}}` tokens. These
  headers are the channel-specific copy you *do* edit here.
- `make render-docs` (`docs/render.mjs`) composes each listing and rewrites image
  refs to release-pinned URLs. It runs automatically before `package-platform`,
  `build-pypi-wheel`, `build-claude-plugin`, and `publish-npm`.
- The composed `packages/**/README.md` are **generated build output, gitignored**
  — never hand-edit them. To change shared copy, edit the toolchain fragment; to
  change channel-specific copy, edit `docs/templates/<target>.md`.
- The repo-root `README.md` (the user-facing storefront landing page) is composed
  the same way from `docs/templates/root.md` + `{{fragment:global}}`, but it is
  **committed** (not gitignored) so GitHub renders it — edit the template, then
  `make render-docs` and commit the result; never hand-edit `README.md`.
- Short `description` fields are stamped by `stamp-versions` (`docs/stamp-descriptions.mjs`)
  from `docs/descriptions.json`; the Homebrew `desc` is passed to `bump-brew` by
  `publish-brew`. `.claude-plugin/marketplace.json` is read from git by Claude, so
  its description stays committed/hand-maintained (not build-stamped).

## Planning lives in GitHub issues, not in this repo

Backlog, roadmap, milestones, and status-of-work bookkeeping belong in
[issues](https://github.com/jmbarzee/temporal-architect-dist/issues), not in a tracked file. When you defer something, open an issue — do not start a
backlog file or add a "Future:" section.

What legitimately stays: documentation of how the system **currently** works (`packaging.md` channel
design and conventions, `documentation_propagation.md` component matrix and compose pipeline,
`publishing_setup.md` rollout state), and configuration the tooling reads.

Engine work — anything shipping inside the `twf` binary — is filed against the toolchain repo
(`jmbarzee/temporal-architect`), not here. (Work on the `twf-serve` binary, which is dist-owned
source, is filed HERE.)

## twf-serve — the one binary built here

`twf-serve` (`packages/twf-serve`) is dist-owned Go source, not a repackaged toolchain binary. It is
a self-contained local HTTP server that hosts the visualizer live: it imports the toolchain's
`tools/lsp/pipeline` **in-process** (no subprocess, no version skew) and embeds the
`packages/serve-ui` single-file bundle. See issue #20.

- **Two toolchain libraries, one binary.** The Go side pins `tools/lsp@vX` (the parse → graph →
  decomposition pipeline); the UI side is `packages/serve-ui`, a build-only package (sibling of
  `packages/webview`) that bundles `@temporal-architect/visualizer`'s `<VisualizerHost>` into one
  self-contained HTML file via `vite-plugin-singlefile`.
- **The embedded bundle is COMMITTED** (`packages/twf-serve/ui/index.html`), unlike the gitignored
  webview bundle — `go install` fetches the module from the proxy and cannot run vite, so the asset
  must travel in the module. `make build-serve-ui` regenerates it.
- **Build + release.** `make twf-serve-archives VERSION=X` cross-compiles the PLATFORMS matrix into
  `dist-assets/twf-serve-vX-*.{tar.gz,zip}`. On release, `_release-twf-serve.yml` publishes a dist
  GitHub Release with those archives (the `vX` tag also backs `go install`) and bumps
  `Formula/twf-serve.rb` via the generalized `bump-brew -name twf-serve`.
- **Version pins ride the bump PR.** `stamp-committed-versions` pins serve-ui's visualizer npm dep;
  `prepare-release.yml` additionally runs `pin-serve-lsp` (tools/lsp go.mod) + `build-serve-ui`, so
  the release tag backs a `go install …/twf-serve@vX` whose deps + embedded UI match `vX`.

## Acquisition paths

`twf-serve` is installable via Homebrew (`brew install jmbarzee/twf/twf-serve`) and
`go install github.com/jmbarzee/temporal-architect-dist/packages/twf-serve@vX` — the dist module has
no `replace` directives, so `go install pkg@version` resolves cleanly.

Historical note: `go install …/tools/lsp/cmd/twf@latest` (the toolchain CLI) was long **broken**
because the toolchain's `tools/lsp/go.mod` carried `replace` directives that `go install pkg@version`
ignores. As of toolchain **v0.14.0** (#151) those replaces were dropped (the glsp fork was renamed to
be requirable directly, and sibling modules pin real pseudo-versions), which is also what makes
`twf-serve`'s in-process import of `tools/lsp` work for external users. Before cross-advertising the
toolchain's own `go install …/twf` path, confirm the current Release still ships a replace-free
`tools/lsp/go.mod`. See `documentation_propagation.md` § Known gaps.
