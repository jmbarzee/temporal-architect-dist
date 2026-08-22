# Documentation Propagation (component view)

**Status:** Working analysis — drives the single-source-of-truth docs effort and
doubles as a lens for finding publishing gaps. Companion to
[`publishing_setup.md`](./publishing_setup.md) (rollout state) and
[`packaging.md`](./packaging.md) (channel design). Not yet a build spec.

## Why this doc

Every published listing (Marketplace long-description, npm/PyPI README, Homebrew
`desc`, Claude marketplace blurb, …) is currently hand-written, and the same
ideas are re-typed across channels — so they drift. The fix is to treat
documentation the way we already treat *artifacts*: a small set of **components**
that each **distribution** composes from, plus one channel-specific blurb.

Looking at publishing through "which components does each channel's doc pull
from?" also surfaces **product/publishing gaps** — components that are real but
shipped nowhere, or advertised everywhere but not actually addressable.

## The doc components

The building blocks any distribution's description can pull from. Canonical
source lives in the **toolchain** repo (`jmbarzee/temporal-architect`); the
channel blurb is the only piece that lives here in **dist**.

| # | Component | What it pitches | Canonical source (toolchain) | Images? | Shipped as |
|---|-----------|-----------------|------------------------------|---------|-----------|
| 1 | **Global vision** | Devs working at *architecture* level: a parseable, validated, visual model of a whole Temporal system | `docs/fragments/global.md` (dedicated fragment; `description:` front-matter is the canonical one-liner) | yes (hero graph) | `{{fragment:global}}` in every channel header |
| 2 | **Parser / `twf` binary** | CLI: `check`/`parse`/`symbols`/`graph`/`lsp`; embedded spec | `tools/lsp/cmd/twf/README.md`, `COMMANDS.md`, `root.go` | no | binary archives, npm `twf`, PyPI, Homebrew, `go install`, VSIX |
| 2a | **MCP server** (`twf mcp`) | Agent entry point: parser tools + spec resources over stdio | `…/internal/command/mcp/mcp.go` (Long + instructions) | no | **subcommand of the binary** (no separate artifact) |
| 3 | **Sampler** | Recover a deployment graph from sampled production history (emits `observed-graph.json`, opened directly in the visualizer) | `tools/sampler/README.md`, `main.go` | maybe (drift overlay) | **nowhere** — `go install` from source only |
| 4 | **Visualizer** | Interactive tree + graph of the system; the part where a picture is worth the pitch | `tools/visualizer/README.md`, `spec/PRODUCT.md`, `TREE_VIEW.md`, `GRAPH_VIEW.md` | **critical** | npm `visualizer` (lib), VSIX (webview) |
| 5 | **Skills** | Design / author-go / author-infra agent skills | `skills/*/SKILL.md` frontmatter + per-skill `README.md` | no | skills tarball → VSIX, claude-plugin |
| 6 | **Channel-specific** | Install method + packaging-format notes; always unique per target | per-target, in **dist** (and the 2 toolchain libs) | rarely | n/a |

(`@temporal-architect/wire-types` is a narrow developer contract — "TS
projection of the wire types" — self-sourced inside its own published tgz and
outside this propagation concern.)

## Propagation matrix (component → distribution)

Which components *should* feed each channel's description. ✅ = primary;
(adv) = advertised capability delivered via the binary but not a separate
artifact; — = out of scope for that listing.

| Distribution | Owner | 1 Global | 2 Parser | 2a MCP | 3 Sampler | 4 Visualizer | 5 Skills | 6 Channel |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| npm `visualizer` | toolchain | light | — | — | — | ✅ (lib) | — | ✅ |
| VS Code / Open VSX (VSIX) | dist | ✅ | ✅ | (adv) | (adv?) | ✅ (webview) | ✅ | ✅ |
| npm `@temporal-architect/twf` (+5) | dist | ✅ | ✅ | (adv) | (adv?) | — | — | ✅ |
| PyPI `twf-cli` | dist | ✅ | ✅ | (adv) | (adv?) | — | — | ✅ |
| Claude plugin (npm payload) | dist | ✅ | (adv) | (adv) | — | — | ✅ | ✅ |
| Claude marketplace catalog | dist | ✅ | (adv) | (adv) | — | — | ✅ | ✅ |
| Homebrew formula | dist | one-liner | ✅ | (adv) | (adv?) | — | — | ✅ |
| `install.sh` / GitHub Release | dist | light | ✅ | (adv) | (adv?) | — | — | ✅ |
| `go install` (twf) | toolchain | light | ✅ | (adv) | — | — | — | ✅ |
| `twf-serve` (Homebrew + `go install`) | dist | light | — | — | — | ✅ (live host) | — | ✅ |
| Smithery MCP registry (future) | dist | ✅ | — | ✅ | — | — | — | ✅ |

Read down a column to see how widely a component must propagate; read across a
row to assemble that listing's description.

## Known gaps

Each is tracked as an issue; this section names them so the matrix above is read with its
limitations in view.

- **The sampler is published nowhere** — real capability, source-install only, so it appears in no
  listing. Also the one genuine multi-binary decision. [#7](https://github.com/jmbarzee/temporal-architect-dist/issues/7)
- **Visualizer: one product, two delivery forms, images.** [#8](https://github.com/jmbarzee/temporal-architect-dist/issues/8)
  *Dist side done:* the VSIX header (`docs/templates/vscode.md`) sources the one canonical pitch via
  `{{fragment:visualizer}}` (the toolchain's `FRAGMENT.md`), and images now render — as of toolchain
  **v0.11.0** the PNGs are committed under `docs/images/` and referenced from `global.md`/`FRAGMENT.md`;
  `render.mjs` rewrites those refs to release-pinned `raw.githubusercontent.com/.../v<version>/...` URLs
  (verified 200 on npm/PyPI/Marketplace-renderable absolute URLs). *Toolchain residual:* the published
  npm `@temporal-architect/visualizer` `README.md` is still a separate hand-written developer README
  that neither embeds the canonical `FRAGMENT.md` pitch nor shows the images — closing #8 needs that
  package (toolchain-owned, published from the toolchain repo) to compose from the same fragment.
- **The global vision pitch is single-sourced.** [#9](https://github.com/jmbarzee/temporal-architect-dist/issues/9)
  *Dist side done:* every dist channel header (`vscode`, `npm-twf`, `pypi`, `claude-plugin`) embeds
  `{{fragment:global}}`, so the long pitch has one source; short `description` fields are stamped from
  `docs/descriptions.json` by `stamp-descriptions.mjs` (the `@global` sentinel inherits the fragment's
  canonical one-liner; the current values are deliberate channel-specific overrides, not drift). No
  hand-written copy of the pitch remains in the dist tree. *Toolchain residual:* the toolchain's own
  root `README.md` still carries the pitch inline rather than composing from `global.md`; that dedup is
  toolchain-owned. (The dist repo's root `README.md` is the storefront's build/how-it-works doc, not a
  product-pitch surface, so it is intentionally not composed from the fragment.)
- **MCP is bundled-only** — every MCP user receives the whole binary and invokes one subcommand.
  That is fine, but it makes a Smithery listing the first MCP-only pitch. [#6](https://github.com/jmbarzee/temporal-architect-dist/issues/6). Skills are
  still not exposed over MCP (the binary does not embed them — toolchain [#77](https://github.com/jmbarzee/temporal-architect/issues/77)); that copy
  stays out of the listings until it lands.
- **`go install` of the toolchain `twf` CLI** — was long broken for external users: `tools/lsp/go.mod`
  carried `replace` directives that `go install pkg@version` ignores. As of toolchain **v0.14.0**
  (#151) those replaces were dropped, which is also what lets `twf-serve` import `tools/lsp`
  in-process. Before re-advertising the toolchain's own `go install …/twf` path (or restoring the
  extension's language-server failure message), confirm the current Release still ships a
  replace-free `tools/lsp/go.mod`. Note this does **not** gate `twf-serve`'s own
  `go install github.com/jmbarzee/temporal-architect-dist/packages/twf-serve@vX`, which is a
  dist-owned module with no replaces and is advertised freely.

## Strategy (implemented) and what's deferred

The compose pipeline described below is **live** (see `AGENTS.md` "How it works"):
fragments in the toolchain's `docs/fragments/` ship inside their artifacts;
`make stage-docs` + `make render-docs` (`docs/render.mjs`) compose the four
generated (gitignored) package READMEs from `docs/templates/*.md`; descriptions
are stamped by `stamp-versions` (`docs/stamp-descriptions.mjs`) from
`docs/descriptions.json`, with the Homebrew `desc` passed to `bump-brew`.

This component model *is* the fragment set for the compose system. Decisions:

- **Composition.** Each listing = `[channel header] + [the component fragments
  its matrix row marks ✅]`. Start with **one global "body" fragment + thin
  per-target headers**; when a target needs genuinely distinct framing, thicken
  *that* header rather than splintering into many per-component fragments.
- **Transport = T1 (Release assets, not npm).** Sub-component docs are **not**
  bound to npm publishing. Docs **live with their published artifact**, which
  cultivates a different mechanism per artifact type:
  - **npm libs** (visualizer, wire-types) — README/description already ride
    inside the published tgz (self-sourced); keep as-is.
  - **go / binary** (parser `twf`, and the sampler once published) — docs ride
    with the binary Release archive; exact mechanism TBD (a fragment file in the
    archive, or embedded in the binary à la `twf spec`). Images for the
    global/parser pitch (which a binary can't render) live in the toolchain and
    are referenced by **release-pinned absolute URLs**.
  - **skills** — ride in the skills tarball (frontmatter), already.

  dist composes each listing from the artifacts it already downloads via
  `fetch-release`; rendered READMEs are **generated output (gitignored) — never
  hand-edited**. The per-target headers are the only doc source tracked in dist.
- **Descriptions.** Short `description` fields are stamped from the same source
  by extending `stamp-versions`.
