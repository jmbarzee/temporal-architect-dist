# Temporal Architect

{{fragment:global}}

## Install

Pick the channel that fits your workflow — every one ships the same `twf` engine (parser, language server, and MCP server) at the same version.

| Channel | Install |
|---|---|
| **VS Code / Cursor** — extension with live diagnostics, the interactive visualizer, and the system-design skills | Search **"Temporal Architect"** in the VS Code Marketplace or Open VSX |
| **npm** — `@temporal-architect/twf` (CLI + language server + MCP server) | `npm install -g @temporal-architect/twf` — or zero-install with `npx -y @temporal-architect/twf` |
| **PyPI** — `twf-cli` (same binary, `pip`-installable) | `pip install twf-cli` |
| **Homebrew** | `brew install jmbarzee/twf/twf` |
| **Claude Code plugin** — the design/author/infra skills plus the `twf` MCP server | `/plugin marketplace add jmbarzee/temporal-architect-dist` then `/plugin install temporal-architect@temporal-architect` |

Prefer a one-liner? The shell installer downloads the platform binary from the latest release:

```bash
curl -sSL https://raw.githubusercontent.com/jmbarzee/temporal-architect-dist/main/packages/install.sh | bash
```

## Quick start

```bash
twf check payments.twf     # validate the whole system — activities, workers, namespaces, Nexus
twf graph payments.twf     # emit the dependency graph as JSON
twf mcp                    # run the MCP server (the agent entry point) over stdio
```

Open any `.twf` file in the VS Code / Cursor extension to explore it in the interactive **Graph View** (namespace → worker → workflow topology) or **Tree View** (expand a call to see the target's body inline).

## Learn more

- **Engine, language spec, and source:** [jmbarzee/temporal-architect](https://github.com/jmbarzee/temporal-architect) — the toolchain repo.
- **The `.twf` language and `twf` commands:** `twf --help`, plus the embedded spec via `twf spec`.
- **Embed the visualizer in your own React app:** [`@temporal-architect/visualizer`](https://www.npmjs.com/package/@temporal-architect/visualizer).

## License

MIT.

---

<sub>**Maintainers:** this repository is the distribution **storefront** — it consumes the toolchain's GitHub Release assets and publishes every end-user package to every registry. This landing page is **generated** from the shared doc fragments by `make render-docs`; do not hand-edit it — change `docs/templates/root.md` or the toolchain's shared global-pitch fragment instead. The two-repo topology, release pipeline, publish channels, secrets, version-stamping/re-run commands, and registry identifiers are documented in [`packaging.md`](./packaging.md).</sub>
