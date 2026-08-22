# twf-serve

Live [temporal-architect](https://github.com/jmbarzee/temporal-architect) design
visualizer over a local HTTP server — the visualizer's **second host**.

`twf-serve` parses a set of `.twf` files **in-process** (importing the toolchain's
`tools/lsp/pipeline` as a library — no subprocess, no version skew), serves the
shared visualizer app at a loopback URL, watches the files, and pushes re-parsed
graphs to the browser over Server-Sent Events on every change. Any agent host
with a browser surface (Claude Code's pane, a plain tab) sees the design graph
live at `http://127.0.0.1:<port>/` without switching to the VS Code / Cursor
webview.

## Install

Homebrew:

```bash
brew install jmbarzee/twf/twf-serve
```

`go install` (Go 1.25+):

```bash
go install github.com/jmbarzee/temporal-architect-dist/packages/twf-serve@latest
```

## Usage

```bash
twf-serve [--port N] [--open] <file...>
```

- `<file...>` — one or more `.twf` files (or directories / globs of them).
- `--port N` — bind port on `127.0.0.1` (default: an OS-assigned free port; the
  chosen URL is printed on startup).
- `--open` — open the served URL in your default browser.
- `--version` — print the version and exit.

The server runs in the foreground and stops on `Ctrl+C`. Edit a watched `.twf`
file and the browser updates in under a second — no reload, no lost view state;
a parse error surfaces diagnostics in place and clears when you fix it.

In the Graph view's **Groups** panel, adjusting the decomposition parameters
(ceiling / floor / strategies) and hitting **Recompute** re-runs the chunk
decomposition in-process and pushes the fresh overlay back to the browser.

## Security

The listener binds `127.0.0.1` only (never `0.0.0.0`), sends a strict
`Content-Security-Policy` that permits only the inlined single-file bundle and
same-origin connections, and has no authentication — it is a single-user,
localhost-only tool by design.

## Endpoints

| Route         | Purpose                                                            |
| ------------- | ------------------------------------------------------------------ |
| `GET /`       | the embedded single-file visualizer app                            |
| `GET /events` | SSE stream; the current payload on connect + on every file change  |
| `GET /graph.json` | the current payload as JSON (scriptable; parity with `twf graph`) |
| `POST /decompose` | recompute the chunk decomposition with new parameters          |

## How it fits

`twf-serve` is built and released by the distribution repo
([temporal-architect-dist](https://github.com/jmbarzee/temporal-architect-dist)),
not the toolchain: it is dist-owned glue over two toolchain libraries — the Go
`tools/lsp/pipeline` (parse → graph → decomposition) and the npm
`@temporal-architect/visualizer` (the `<VisualizerHost>` shell, bundled into the
single embedded HTML file by `packages/serve-ui`). See
[issue #20](https://github.com/jmbarzee/temporal-architect-dist/issues/20).
