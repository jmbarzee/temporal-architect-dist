# Temporal Architect

{{fragment:global}}

## Install

Search for **"Temporal Architect"** in the VS Code or Cursor extension marketplace. The extension bundles the `twf` binary (language server + parser), the system-design skills (auto-installed to `~/.cursor/skills/`), and the architecture visualizer — no additional setup required.

## What you get

- **Live diagnostics** — undefined activities, broken references, duplicate definitions, and determinism traps flagged as you type, plus completions, hover, go-to-definition, references, and rename.
- **Interactive visualizer** — open any `.twf` file as a Graph View or Tree View from the editor title bar or command palette.
- **System-design skills** — Design, Go authoring, and Infra provisioning, available to your AI agent.
- **Bundled `twf` CLI** — the same parser/LSP binary on your PATH, including `twf graph --history <dir>` to recover a deployment graph from sampled production histories.

## Commands

| Command | Description |
|---------|-------------|
| **TWF: Visualize Workflow** | Open the interactive visualizer for the current `.twf` file |
| **TWF: Visualize All Workflows in Folder** | Visualize all `.twf` files in a folder |
| **Temporal Architect: Install Skills** | Re-install the system-design skills to `~/.cursor/skills/` |

{{fragment:visualizer}}

## Skills

{{skills}}

{{fragment:mcp}}

## License

MIT
