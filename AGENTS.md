# temporal-architect-dist

The **storefront** for the temporal-architect toolchain. This repo does **no
source build**: it downloads the toolchain's (`jmbarzee/temporal-architect`)
GitHub Release assets (binaries, skills tarball, visualizer lib, wire-types),
stamps the incoming version into every manifest, repackages, and publishes to
every registry (VS Code Marketplace / Open VSX, npm `@temporal-architect/twf` +
platform sub-packages, PyPI `twf-cli`, Claude plugin + marketplace catalog,
Homebrew). The toolchain owns the engine and the canonical Release and publishes
its own libraries (`visualizer`, `wire-types`); this repo publishes every
**end-user consumption model**. See `packaging.md` (channel design) and
`publishing_setup.md` (rollout state).

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
- Short `description` fields are stamped by `stamp-versions` (`docs/stamp-descriptions.mjs`)
  from `docs/descriptions.json`; the Homebrew `desc` is passed to `bump-brew` by
  `publish-brew`. `.claude-plugin/marketplace.json` is read from git by Claude, so
  its description stays committed/hand-maintained (not build-stamped).

## Don't re-advertise broken acquisition paths

`go install …/tools/lsp/cmd/twf@latest` is currently **broken** for external
users (the toolchain's `tools/lsp/go.mod` has `replace` directives that
`go install pkg@version` ignores). Do not add or cross-advertise it on any
channel until the toolchain drops those replaces. See
`documentation_propagation.md` gap 7.
