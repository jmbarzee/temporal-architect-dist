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
| 1 | **Global vision** | Devs working at *architecture* level: a parseable, validated, visual model of a whole Temporal system | root `README.md` tagline + "Why" (no dedicated fragment yet) | maybe (hero graph) | — (prose only) |
| 2 | **Parser / `twf` binary** | CLI: `check`/`parse`/`symbols`/`graph`/`lsp`; embedded spec | `tools/lsp/cmd/twf/README.md`, `COMMANDS.md`, `root.go` | no | binary archives, npm `twf`, PyPI, Homebrew, `go install`, VSIX |
| 2a | **MCP server** (`twf mcp`) | Agent entry point: parser tools + spec resources over stdio | `…/internal/command/mcp/mcp.go` (Long + instructions) | no | **subcommand of the binary** (no separate artifact) |
| 3 | **Sampler** | Recover a deployment graph from sampled production history (`twf graph --history` intake) | `tools/sampler/README.md`, `main.go` | maybe (drift overlay) | **nowhere** — `go install` from source only |
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
| Smithery MCP registry (future) | dist | ✅ | — | ✅ | — | — | — | ✅ |

Read down a column to see how widely a component must propagate; read across a
row to assemble that listing's description.

## Gaps this view surfaces

1. **Sampler is published nowhere.** It is a real capability (the intake for
   `twf graph --history`, the seed for the observed-vs-designed overlay) but
   ships only via `go install …/tools/sampler` from source — so it appears in no
   listing and no binary archive. Decisions: (a) fold its pitch into the Parser
   component and ship the `sampler` binary alongside `twf` in the relevant
   channels, or (b) leave it dev-only and document that explicitly. Today it is
   silently invisible — the `(adv?)` cells above are the open question of whether
   any binary channel should foreground it.

2. **MCP is real now, but bundled-only.** `twf mcp` exists and is registered;
   the long-standing "advertised but doesn't exist" gap (see
   [`full_toolchain_distribution.md`](../temporal-architect/full_toolchain_distribution.md))
   is resolved for the parser-tools + spec-resources surface. Two residual
   doc-truth issues: (a) **skills are not exposed over MCP yet** (the binary
   doesn't embed them — parked M1); the previously over-promising "MCP exposes
   skill prompts" copy has been removed from the package READMEs, and should stay
   out until M1 lands; (b) there is **no MCP-only distribution** — every MCP user
   receives the whole binary and invokes one subcommand. That is fine, but it
   means a Smithery listing (future) is the first doc whose pitch is *MCP only*.

3. **"Several binaries?" — mostly a no, except the sampler.** Cutting the `twf`
   binary apart (e.g. a standalone `mcp` binary) would multiply the platform
   archive/sub-package matrix for little gain, since MCP is just a subcommand and
   MCP-only channels already work via `twf mcp`. The genuine "extra binary" is
   the **sampler**, which already is a separate `main` and is the actual
   multi-binary decision to make (see gap 1).

4. **Visualizer: one pitch, two delivery forms, no images.** The npm `visualizer`
   (embeddable React lib) and the VSIX **webview** are the same product and
   should share one pitch, but today they carry separate hand-written copy.
   Images are *critical* here and are currently **absent** (only commented
   `docs/images/…` placeholders exist). The compose system must (a) source one
   canonical visualizer pitch consumed by both forms, and (b) solve image
   hosting — real image files in the toolchain, referenced by **release-pinned
   absolute URLs** so every registry renders them.

5. **Global vision is duplicated and divergent.** The core "architecture-level"
   pitch is re-typed (with drift) in the root README, the VSIX page, and the
   npm/PyPI READMEs. This is the central driver for the SSOT effort: one shared
   vision fragment, included by every channel.

6. **Full-toolchain assembly gap (carried over).** No single channel delivers all
   of {parser, MCP, visualizer, skills} *and* points the user to the rest;
   binary-only channels ship no skills, skill-only channels don't say how to get
   the binary. Tracked in the parked `full_toolchain_distribution.md`; relevant
   here because the per-channel descriptions are where the "assemble the rest"
   cross-links would live.

7. **`go install` is broken for external users.** `tools/lsp/go.mod` carries two
   `replace` directives (`tools/spec => ../spec` and the `tliron/glsp` fork) and
   `go install pkg@version` **ignores** `replace` — so external resolution fails
   (`tools/spec` is pinned to a zero pseudo-version only the relative replace
   satisfies; the glsp fork is the toolchain's documented temporary patch). The
   advertising has been walked back: the toolchain README + `tools/lsp/cmd/twf/README.md`
   now say clone-and-build-from-source only, the composed listings here don't
   mention it, and `publishing_setup.md` / `packaging.md` were corrected to the
   source-clone form. Until both replaces are gone (spec published as a real
   module + the upstream glsp PR lands), `go install …@latest` must not be
   re-advertised anywhere.

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

**Deferred:** the **sampler** publish + pitch (revisit when we publish it —
gap 1); foregrounding MCP/sampler beyond "advertised" (gaps 1–3); fixing and
re-advertising `go install` (gap 7).
