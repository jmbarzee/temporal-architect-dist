# Distribution Backlog

Net-new distribution / onboarding work that isn't already tracked in the
structured docs. This is the storefront repo, so items here are about
*acquisition* and *graceful hook-in*, not engine features. Engine work (anything
that ships inside the `twf` binary) lives in the toolchain repo's `ROADMAP.md` /
`internal/changes/parser/BACKLOG.md`; cross-referenced items are marked
**(toolchain)**.

## Where things are tracked (read this first)

To avoid drift, most distribution work already has a home — check there before
adding here:

- **`packaging.md`** — channel design + the distribution **milestones**:
  M3 extension PATH wiring (done), M5 go-live, M6 docs site, and the registry
  **registration** table (incl. the **Smithery MCP registry** submission).
- **`documentation_propagation.md`** — listing-copy SSOT effort and the open
  **doc gaps**: gap 1/3 sampler-published-nowhere, gap 2 MCP residual (skills not
  over MCP yet; the first MCP-only listing is the future Smithery one), gap 4
  visualizer one-pitch-two-forms + missing images, gap 5 global-vision drift,
  gap 6 full-toolchain assembly / "assemble the rest" / skill→binary, gap 7
  `go install` advertised-but-broken.
- **toolchain `full_toolchain_distribution.md`** — the parked per-audience
  acquisition decision (IDE / CLI / agent) that gap 6 above implements.

The items below are the ones **not** covered by any of those.

## MCP onboarding — "gracefully hooking into AI sessions"

Acquisition of the MCP server is solved (`twf mcp` ships in the binary on every
channel; clients can launch it zero-install via `npx -y @temporal-architect/twf mcp`).
The remaining work is making *registration* into a client session graceful.

**Done:**
- Claude Code plugin auto-registers `mcpServers.twf` via `.claude-plugin/marketplace.json`.
- The VS Code/Cursor extension auto-registers the bundled `twf mcp` server in
  `~/.cursor/mcp.json` on activation (ownership-aware merge; `twf.mcp.autoRegister`
  setting + "Register MCP Server" command). **Cursor-shaped only.**

**Backlog:**

- **VS Code native MCP provider (extension).** Extension auto-registration writes
  `~/.cursor/mcp.json`, which only Cursor reads. Support stock VS Code via the
  native MCP API (`vscode.lm.registerMcpServerDefinitionProvider` /
  `contributes.mcpServerDefinitionProviders`); requires bumping
  `packages/vscode/package.json` `engines.vscode` from `^1.75.0` to `^1.101`, and
  picking the path by host (`vscode.env.appName`).

- **Pin the Claude-plugin MCP launch line (optional).**
  `.claude-plugin/marketplace.json` wires `npx -y @temporal-architect/twf mcp`
  unpinned, so the MCP binary is always npm-latest while the plugin's skills are
  stamped to the release version — they can drift. Consider pinning the `args` to
  the plugin's `version` (stamped on consume) so MCP and skills move together.
  (Surfaced by the version-alignment note in toolchain `parser/BACKLOG.md`.)

- **`twf mcp install [--client cursor|claude-desktop|continue|vscode]` (toolchain).**
  An engine helper that merges the server entry into a target client's config
  with one command — the graceful path for standalone clients (Claude Desktop,
  Continue, Windsurf, Zed) that have neither the plugin nor the extension.
  Highest-leverage onboarding fix; lives in the binary so it serves every channel.

- **Project-scoped MCP config (toolchain).** `twf init --mcp` (M4 scaffolder in
  the toolchain `ROADMAP.md`) emits a committed `.cursor/mcp.json` / `.mcp.json`
  so a whole team's agents pick up `twf` from the repo.

## Extension features

- **Interactive decomposition recompute.** The Graph-view group overlay runs
  `twf graph chunks` once at activation using `twf.decompose.ceiling`; changing
  the ceiling/params needs a reload. Add a host round-trip — the webview posts a
  `recomputeDecomposition` message, the extension re-runs the CLI and returns a
  fresh payload — so ceiling/floor/strategy are interactive. (From the toolchain
  chunks change-set BACKLOG; standalone/read-only until a WASM or server path
  exists.)

## Acquisition copy

- **Name the visualizer extension wherever it's referenced.** The design skill
  (`skills/temporal-architect-design/SKILL.md`) says "suggest the TWF visualizer
  extension" without naming `jmbarzee.twf-syntax` or giving an install line; do
  the same for the `@temporal-architect/visualizer` embed option. Edit lands in
  the **toolchain** skills (a doc component per `AGENTS.md`), but it's a packaging
  /acquisition concern. Related to `documentation_propagation.md` gap 6 and the
  candidate fixes in toolchain `full_toolchain_distribution.md`.
