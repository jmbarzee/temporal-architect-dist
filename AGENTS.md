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

> Status: the compose pipeline is being built. Until it lands, the package
> READMEs under `packages/**` are still hand-written; when editing them, change
> copy at the component level conceptually and mirror it across channels per the
> matrix, so the eventual extraction into fragments is mechanical.

## Don't re-advertise broken acquisition paths

`go install …/tools/lsp/cmd/twf@latest` is currently **broken** for external
users (the toolchain's `tools/lsp/go.mod` has `replace` directives that
`go install pkg@version` ignores). Do not add or cross-advertise it on any
channel until the toolchain drops those replaces. See
`documentation_propagation.md` gap 7.
