# Packaging and Distribution

How temporal-architect ships — the catalog of distribution channels, the conventions that govern packaging work, and the remaining milestones to close out the epic.

> **Two-repo topology.** The dividing line is **library vs. distribution**, not which
> registry a package lands on. This is the **distribution repo**
> (`jmbarzee/temporal-architect-dist`): it consumes the toolchain's GitHub Release assets
> and publishes every *end-user consumption model* (CLI wrappers, VSIX, claude-plugin,
> PyPI, Homebrew). The **toolchain repo** (`jmbarzee/temporal-architect`) is the engine: it
> builds the source, **publishes its own libraries** (`@temporal-architect/visualizer` +
> `@temporal-architect/wire-types`) to npm, and cuts a single GitHub Release of primitive
> artifacts (per-platform `twf` binaries, `skills-vX.Y.Z.tar.gz`, the visualizer +
> wire-types library tarballs, `SHA256SUMS`), then fires a `repository_dispatch` carrying
> the version. This repo stamps that version into its manifests and publishes in lockstep.
> The curl-bash `install.sh` lives in this repo (served via raw URL) and downloads the
> binary from that Release.
>
> The `_publish-*` workflows, registry secrets, and packaging manifests
> (`packages/vscode`, `packages/npm`, `packages/pypi`, `.claude-plugin`, `bump-brew`) live
> here. Sections below describe the *combined* system across both repos; the build/release-cut
> half is owned by the toolchain. **Note:** the M1/M2/M4 milestones are toolchain *engine*
> features (self-describing binary, MCP server, `twf init`) tracked here only because they
> close out the packaging epic — implement them in the toolchain repo.

## Audiences

The packaging story serves three audiences:

1. **Agentic runtimes** — Claude Desktop, Cursor MCP, CI bots, the spec-builder Temporal worker. Want typed, discoverable tool access and structured outputs.
2. **AI-assisted human devs across IDEs** — Cursor, Claude Code, Continue, Windsurf, Codex CLI, Copilot, Zed, Aider. Want SKILL.md or rules-style files plus a callable CLI.
3. **Programmatic consumers** — Python/TS scripts that drive an LLM and shell out to `twf`. Want a single install command and stable contracts.

The bundle is intentionally small: **one binary** (`twf`), **one npm package** (`@temporal-architect/twf`), **one marketplace plugin** (Claude Code). Everything else is metadata pointing at those three.

## Constraints

- **No paid hosting.** GitHub-native only: Releases, Pages, repos. No `temporal-architect.dev`, no hosted MCP, no telemetry sink.
- **Effort weighted toward packaging and publishing**, not authoring new content or running services.
- **Everything publishes via GitHub Actions on a `v*` tag.** Lockstep versioning across every artifact: one tag, one fan-out. The `release.yml` orchestrator is the trunk; every new target is a job in the matrix. No manual `npm publish` / `twine upload`.

---

## Current state

Distribution surfaces and where their sources live:

Distribution surfaces, where their source lives (T = this toolchain repo, D = dist repo), and how they ship:

| Channel | Source | Install line | Audience |
|---|---|---|---|
| Go binary direct | `tools/lsp/` (T) | `curl -sSL .../install.sh \| bash` or `go install .../tools/lsp/cmd/twf@latest` | Direct binary users |
| VS Code / Cursor / Open VSX extension | `packages/vscode/` (D); binary + wire-types downloaded from the T Release; webview built in `packages/webview/` (D) from the visualizer library | VSIX (5 platforms) on VS Code Marketplace + Open VSX | Cursor, VS Code, Codium devs |
| npm wrapper + 5 platform sub-packages | `packages/npm/` (D); binary archives from the T Release | `npx -y @temporal-architect/twf` (also the canonical MCP install line) | Node / TS, MCP clients |
| npm visualizer + wire-types | built **and published in T** (`tools/visualizer`, `tools/wire-types`) — libraries, published from the repo that owns them | `npm install @temporal-architect/visualizer` / `…/wire-types` | Library + type consumers |
| PyPI wheels | `packages/pypi/twf-cli/` (D); binary archives from the T Release | `pip install twf-cli` | Python ecosystem, spec-builder Temporal worker |
| Homebrew tap | `bump-brew` (D) against `jmbarzee/homebrew-twf`, pinning T Release URLs/SHAs | `brew install jmbarzee/twf/twf` | macOS / Linux desktop devs |
| Claude Code plugin | `packages/npm/claude-plugin/` (D); catalog at `.claude-plugin/marketplace.json` (D root) | `/plugin marketplace add jmbarzee/temporal-architect-dist` | Claude Code users |
| Skills tarball | `skills/` (T) via `internal/release/gen-skills-manifest/` | `skills-vX.Y.Z.tar.gz` GitHub Release asset | Prompt-library builders, non-binary consumers |

All channels converge on the same `twf` binary and the same embedded skills + spec.

### Release pipeline (two repos, one event)

```
[toolchain repo]  git tag vX.Y.Z && git push --tags
        |
        v
release.yml (release-cutter + library publisher)
  +-- _check-versions          assert tools/visualizer + tools/wire-types match the tag
  +-- _build-binaries          matrix: 5 platforms; twf binary archives
  +-- _build-skills-tarball    deterministic skills-vX.Y.Z.tar.gz asset
  +-- _build-artifacts         visualizer lib + wire-types tarballs
  +-- _publish-npm-libs        npm publish visualizer + wire-types (OIDC + provenance)
  +-- _publish-github-release  SHA256SUMS + all assets (binaries, skills, visualizer, wire-types)
  +-- dispatch-dist            repository_dispatch {version} -> dist repo (DIST_DISPATCH_TOKEN)
        |
        v
[dist repo]  _consume-release.yml (on repository_dispatch: toolchain-release)
  +-- download all Release assets; stamp manifests to vX.Y.Z; _check-versions
  +-- _publish-vsix             VS Code Marketplace + Open VSX (builds webview from visualizer lib)
  +-- _publish-npm-twf          @temporal-architect/twf + 5 platform sub-packages
  +-- _publish-npm-claude-plugin @temporal-architect/claude-plugin
  +-- _publish-pypi             twf-cli wheels x 5 + twine upload
  +-- _publish-brew             bump-brew -> jmbarzee/homebrew-twf formula
```

The toolchain keeps `GITHUB_TOKEN` + `DIST_DISPATCH_TOKEN` and publishes its two npm
libraries via OIDC trusted publishing (no token; `id-token: write`). All other registry
secrets live in dist. The visualizer + wire-types tarballs are still attached to the
Release so dist consumes them at build time (VSIX types + webview) without an npm round-trip.

---

## Conventions

These rules govern any new packaging work.

### C1. Go release tooling lives in `internal/release/<name>/`

Each tool is its own Go module, wired into `go.work`. Structure per tool:

```
internal/release/<name>/
  go.mod
  main.go
  main_test.go
```

New tools follow the same shape and add their directory to `go.work`'s `use` list.

### C2. Single-manifest npm publishing

Each npm package's `package.json` is *both* the dev manifest *and* the publish manifest:

- Scoped public name (e.g. `@temporal-architect/visualizer`).
- `"files"` allowlist — only ship build output, README, LICENSE; never source or devDeps.
- `"prepublishOnly"` runs the build before `npm publish`.
- `"prepack"` / `"postpack"` copy `LICENSE` from the repo root and clean up after.
- `"peerDependencies"` (not `"dependencies"`) for consumer-managed runtime deps like React.
- `"devDependencies"` stays for the dev workflow; doesn't ship because of the `files` allowlist.

Generalizes to wrapper + sub-package shapes (e.g. `@temporal-architect/twf`).

### C3. Inline sed for version bumping

`Makefile`'s `release:` target uses `sed -i.bak` per manifest. Each new manifest gets one more `sed` line. Pattern:

```makefile
@sed -i.bak 's/"version": *"[^"]*"/"version": "$(NEW_VERSION)"/' <file> && rm -f <file>.bak
```

`.claude-plugin/marketplace.json` carries `version` strings inline (the plugin entry uses Claude Code's `strict: false` mode and declares the plugin definition directly). The `release:` target's `sed -g` flag updates every `"version"` key in the file in lockstep.

### C4. Verb-noun Makefile naming

Targets follow `<verb>-<thing>[-<variant>]`:

- `build-webview`, `build-extension`, `build-claude-plugin` (dist); `build-lsp`, `build-visualizer-lib` (toolchain)
- `build-twf-archive`, `build-skills-archive`, `build-pypi-wheel`
- `package-platform`, `package-all`
- `publish-vscode`, `publish-ovsx`, `publish-npm-platform`, `publish-npm`, `publish-npm-claude-plugin`, `publish-pypi`, `publish-brew`

### C5. Manifest version validation

`_check-versions.yml` asserts the git tag matches every checked-in manifest's version. Each manifest gets one `check_node` or `check_pyproject` call. Inline bash; no extracted Go validator.

### C6. Phase-based reusable workflows

`.github/workflows/release.yml` is a thin orchestrator. Per-phase reusables use a phase prefix (`_check-`, `_build-`, `_publish-`). Secrets are passed **explicitly** by the orchestrator — each reusable declares which secrets it needs via `workflow_call.secrets`. No `secrets: inherit` anywhere.

New publish channels follow the pattern: one new `_publish-<channel>.yml` file plus one `<channel>:` job in `release.yml`.

### C7. Claude Code plugin ships from npm; only the marketplace catalog stays at the root

The Claude Code plugin payload (`@temporal-architect/claude-plugin`) lives at [`packages/npm/claude-plugin/`](./packages/npm/claude-plugin/) like every other npm package. Its `skills/` is a **build artifact** — `make build-claude-plugin` rsyncs the canonical `skills/` from the repo root into the package; the copy is gitignored.

The marketplace catalog at `.claude-plugin/marketplace.json` is the only thing forced to live at the repo root. It uses `strict: false` to declare the plugin's components inline (skills path, MCP server config) and points at the npm package as the plugin source. Claude Code does `npm install` to fetch the payload at install time.

The dev-cycle harness (the `.claude/skills/dev-cycle/` skill plus its manifest `internal/harness/components.md`) and the standalone helper skills (`.claude/skills/expand-idea/`, `.claude/skills/reflect-skill/`) are intentionally **not** part of the plugin — they are dev scaffolding for this repo, not for downstream users. `internal/` is dev-only by convention, and the shipped skills come from the repo-root `skills/`, never from `.claude/skills/`.

---

## Goals

> **Engine milestones live in the toolchain.** M1 (self-describing binary),
> M2 (MCP server), and M4 (`twf init` scaffolder) are `twf` binary features —
> they moved to the toolchain's
> [`ROADMAP.md`](https://github.com/jmbarzee/temporal-architect/blob/main/ROADMAP.md).
> What remains here are the distribution-side milestones: extension PATH wiring
> (M3), go-live (M5), and the docs site (M6).

### M3 — Agent-discoverable binary on PATH

**Status:** 3.1 + 3.2 + 3.3 done — `linkTwfOnPath` in `packages/vscode/src/extension.ts` symlinks the bundled `twf` into `~/.local/bin` on activation (copy on Windows), refreshes per version, and guards a user-managed `twf` via a `globalState`-recorded ownership marker. 3.3 (skill/onboarding note) landed via the reposition: the README "Skills" section documents that skills assume `twf` on PATH and the agent's graph surface is `twf graph --json` (the visualizer GUI stays human-facing via `twf.visualize`).

The extension bundles `twf` and prepends its `bin/` to the **integrated terminal** via
`environmentVariableCollection` (`setupTerminalPath`), but that does **not** reach the AI agent's
shell — confirmed empirically: in an agent shell with the extension installed, `twf` resolves only
if the user separately `go install`ed it (`~/go/bin/twf`); the extension `bin/` is absent from the
agent PATH. So extension-only users (the common case) get an AI that can't find `twf` and digs around
or runs full paths. (This was the reverse-engineering reflection's recurring friction.)

| | Work | Effort |
|---|---|---|
| 3.1 | On activation, symlink (or copy) bundled `twf` into a dir already on the agent PATH — `~/.local/bin/twf` on macOS/Linux (confirmed present; already holds `claude`), platform equivalent on Windows. Refresh on each activation so it tracks the extension version. | S |
| 3.2 | Guard: don't clobber a user-managed `twf` (e.g. if `~/.local/bin/twf` exists and isn't our symlink, leave it / warn). Keep the existing integrated-terminal `environmentVariableCollection` for human terminals. | S |
| 3.3 | **Done.** Skill/onboarding note: skills assume `twf` on PATH; the **visualizer** is not a CLI — the agent's surface to graph data is `twf graph --json` (the GUI stays human-facing via the `twf.visualize` command). Landed in the README "Skills" section via the reposition. | S |

**Acceptance:** With only the extension installed (no `go install`), a fresh agent shell resolves
`twf` on PATH and `twf graph --json` works. No path-digging.

**Why it matters (North Star):** keeping the AI out of "where is the tool" busywork is exactly the
context-protection the project is built on.

### M5 — Go live (external accounts + first publish)

External event-driven. Stand up the remaining external accounts so the next tag
push doesn't fail on new publish channels (see [External account checklist](#external-account-checklist)),
then cut a `v*` tag to publish on every channel for the first time.

**Effort:** account creation latency plus one real-tag run; see [`publishing_setup.md`](./publishing_setup.md).

### M6 — GitHub Pages docs site (optional polish)

Static site from `tools/spec/sections/*.md` + `skills/**/*.md` + the standalone visualizer build, hosted at `<user>.github.io/temporal-architect/`. mkdocs-material or Docusaurus.

**Recommended:** defer until M1-M5 are settled. Lowest leverage in the plan.

**Effort:** ~1-2 days.

---

## External account checklist

Out-of-band steps required before the next tag push works end-to-end. None can be automated; all need account creation, manual approvals, or GitHub repo secret management.

### Already configured

| Service | Account / value | GitHub secret |
|---|---|---|
| VS Code Marketplace | publisher `jmbarzee` | `VSCE_TOKEN` |
| Open VSX | publisher `jmbarzee` | `OVSX_TOKEN` |
| npm | scope `@temporal-architect` (claimed for visualizer) | `NPM_TOKEN` (reused for `@temporal-architect/twf*`) |
| GitHub Releases | repo `jmbarzee/temporal-architect` | (built-in `GITHUB_TOKEN`) |

### Pending (block next tag push on the new channels)

| Channel | What to register | GitHub secret | One-time setup |
|---|---|---|---|
| **PyPI** | Create account at pypi.org. Reserve `twf-cli` (or chosen alternative) by publishing v0.0.0 or first real release. | `PYPI_TOKEN` (API token from pypi.org → Account settings → API tokens; scope to the project once reserved) | Account verification (email), 2FA strongly recommended, optional TestPyPI account for dry-runs. |
| **Homebrew tap** | Create `jmbarzee/homebrew-twf` (or matching the chosen tap pattern). Push one initial `Formula/twf.rb` (any version is fine; first `bump-brew` run overwrites). | `HOMEBREW_TAP_TOKEN` (PAT with `repo` write scope on the tap repo) | One-time `brew tap-new jmbarzee/twf` locally → push. |

### Post-M2

| Channel | What to register | Notes |
|---|---|---|
| Smithery MCP registry | Submit MCP server at smithery.ai/new with the install line. Optionally `/.well-known/mcp/server-card.json` in the repo for auto-extraction. | Free; no secret needed (Smithery proxies/lists). |

### Final secrets table

What `release.yml`'s reusable workflows expect, in one place:

| Secret | Used by | Required for | Source |
|---|---|---|---|
| `VSCE_TOKEN` | `_publish-vsix.yml` | every release | VS Code Marketplace publisher dashboard |
| `OVSX_TOKEN` | `_publish-vsix.yml` | every release | open-vsx.org publisher dashboard |
| `NPM_TOKEN` | (retired) npm publishing now uses OIDC trusted publishing — `@temporal-architect/twf*` + `claude-plugin` from this repo (`_consume-release.yml`), `visualizer` + `wire-types` from the toolchain (`release.yml`) | — | no token; configure GitHub Actions trusted publishers per package on npmjs.com |
| `PYPI_TOKEN` | `_publish-pypi.yml` | every release | pypi.org → Account settings → API tokens |
| `HOMEBREW_TAP_TOKEN` | `_publish-brew.yml` | every release | github.com → Settings → Developer settings → PAT (`repo` scope on `<owner>/homebrew-twf`) |

Missing secrets fail the corresponding job with a clear "Error: <SECRET> not set" message; other jobs proceed independently.

---

## Suggested sequencing

Engine milestones (M1, M2, M4) are sequenced in the toolchain
[`ROADMAP.md`](https://github.com/jmbarzee/temporal-architect/blob/main/ROADMAP.md).
Distribution-side, in order:

1. **External account setup** (§ External account checklist) — can happen any time; gates the first publish.
2. **Go live (M5)** — cut the next `v*` tag once external accounts exist; smoke-test each channel per [`publishing_setup.md`](./publishing_setup.md).
3. **M6** if there's appetite for a docs site.

Total remaining (distribution): external account setup + first publish, plus the optional docs site;
engine milestones are tracked separately in the toolchain roadmap.

---

## What we are explicitly *not* doing

- No hosted MCP server (local-only over stdio).
- No paid domain or hosted docs site (Pages only, if anything).
- No telemetry (no infrastructure to receive it).
- No skill registry of our own (we list on the ecosystem's: Smithery, Claude Code marketplaces, Cursor's auto-discovery, agentskills.io if that materializes).
- No backwards-compat shims for pre-v1 contracts (per AGENTS.md).

---

## References

- [Model Context Protocol — Specification](https://modelcontextprotocol.io/specification/latest)
- [Anthropic Agent Skills — Specification](https://agentskills.io/specification)
- [Cursor Docs — Agent Skills](https://cursor.com/docs/skills)
- [Claude Code Docs — Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [AGENTS.md](https://agents.md/)
- [Smithery — Publish an MCP server](https://smithery.ai/docs/build/publish)
- [mark3labs/mcp-go](https://github.com/mark3labs/mcp-go)
- [modelcontextprotocol/go-sdk](https://github.com/modelcontextprotocol/go-sdk)
- [Distributing Platform-Specific Binaries with npm](https://www.magicbell.com/blog/distributing-platform-specific-binaries-with-npm)
- [Homebrew — Create and Maintain a Tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
