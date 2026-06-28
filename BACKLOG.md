# Distribution Backlog

Deferred distribution / onboarding work. This is the storefront repo, so items
here are about *acquisition* and *graceful hook-in*, not engine features. Engine
work (anything that ships inside the `twf` binary) lives in the toolchain repo's
`ROADMAP.md` / `internal/changes/parser/BACKLOG.md`; cross-referenced items below
are marked **(toolchain)**.

## MCP onboarding — "gracefully hooking into AI sessions"

Acquisition of the MCP server is solved (`twf mcp` ships in the binary on every
channel, and clients can launch it zero-install via `npx -y @temporal-architect/twf mcp`).
The remaining work is making the *registration* into a client session graceful
rather than hand-edited JSON.

**Done:**
- Claude Code plugin auto-registers `mcpServers.twf` via
  `.claude-plugin/marketplace.json`.
- The VS Code/Cursor extension auto-registers the bundled `twf mcp` server in
  `~/.cursor/mcp.json` on activation (ownership-aware merge; `twf.mcp.autoRegister`
  setting + "Register MCP Server" command). **Cursor-shaped only.**

**Backlog:**

- **VS Code native MCP provider (extension).** The extension's auto-registration
  currently writes `~/.cursor/mcp.json`, which only VS Code's Cursor fork reads.
  Support stock VS Code via the native MCP API
  (`vscode.lm.registerMcpServerDefinitionProvider` /
  `contributes.mcpServerDefinitionProviders`). Requires bumping
  `packages/vscode/package.json` `engines.vscode` from `^1.75.0` to `^1.101`.
  Pick the registration path by host (`vscode.env.appName`).

- **Smithery / MCP registry listing.** Submit a registry listing so MCP clients
  can discover and one-click-install `twf` (launch line:
  `npx -y @temporal-architect/twf mcp`). Already flagged as a planned channel in
  `packaging.md`; promote it to a real submission once a release with `twf mcp`
  is live.

- **Pin the Claude-plugin MCP launch line (optional).**
  `.claude-plugin/marketplace.json` wires `npx -y @temporal-architect/twf mcp`
  unpinned, so the MCP binary is always npm-latest while the plugin's skills are
  stamped to the release version — they can drift. Consider pinning the `args`
  to the plugin's `version` (stamped on consume) so MCP and skills move together.

- **`twf mcp install [--client cursor|claude-desktop|continue|vscode]` (toolchain).**
  An engine helper that merges the server entry into a target client's config
  file with one command — the graceful path for every standalone client
  (Claude Desktop, Continue, Windsurf, Zed) that has neither the plugin nor the
  extension. Highest-leverage onboarding fix; lives in the binary so it serves
  installs from every channel. Track in the toolchain MCP backlog.

- **Project-scoped MCP config (toolchain).** `twf init --mcp` (M4 scaffolder)
  emits a committed `.cursor/mcp.json` / `.mcp.json` so a whole team's agents
  pick up `twf` from the repo. Depends on the `twf init` work in the toolchain
  `ROADMAP.md`.
