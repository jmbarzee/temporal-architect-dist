# @temporal-architect/serve

Serve the [Temporal Architect](https://github.com/jmbarzee/temporal-architect)
visualizer over local HTTP, live-reloading as your `.twf` files change.

```bash
npx @temporal-architect/serve path/to/design/
# → twf-serve: watching 1 input(s), serving http://127.0.0.1:52341/
```

Open the printed URL (or pass `--open`) and you get the interactive architecture
graph in your browser. Edit any `.twf` file in the tree and the graph updates
live.

## What it is

The **Node/npx sibling** of the Go `twf-view` binary. Same job, same wire
contract, different substrate:

- `twf-view` (Go) imports the toolchain pipeline **in-process** and ships as a
  self-contained platform binary (Homebrew / `go install`).
- `@temporal-architect/serve` (this) **subprocesses** the `twf` CLI — for users
  who live in Node and would rather `npx` than install a binary, and for
  embedding the live-serve loop in an existing Node dev workflow.

Both render through the same shared `<VisualizerHost>` browser shell over an SSE
adapter, and both drive the same UI→toolchain decomposition trigger.

## Usage

```
twf-serve [--port N] [--open] [--twf <path>] <file-or-dir...>
```

| Flag | Meaning |
| --- | --- |
| `--port N` | Port to bind on `127.0.0.1` (default: OS-assigned). |
| `--open` | Open the served URL in the default browser. |
| `--twf <path>` | Path to the `twf` binary (default: the bundled `@temporal-architect/twf`, else `twf` on PATH). |
| `--version` | Print version and exit. |

A directory argument means "every `.twf` under it"; a file argument is taken
verbatim. The set is re-scanned on every change, so newly created or deleted
files are picked up too.

The server binds `127.0.0.1` only — never `0.0.0.0` — and serves a single-file
bundle under a strict, inline-only CSP. It is a single-user local tool.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /` | The visualizer single-file bundle. |
| `GET /events` | SSE stream: current payload on connect, then a fresh frame on every change. |
| `POST /decompose` | The UI→toolchain trigger; recompute the chunk-decomposition overlay. |
| `GET /graph.json` | Scriptable parity endpoint: the current wrapped payload as JSON. |

## Requirements

Node ≥ 18. The `twf` binary travels as the `@temporal-architect/twf` runtime
dependency, so `npx` needs nothing else installed. The subprocess glue and
payload assembly are shared with the VS Code extension via
[`@temporal-architect/payload`](https://www.npmjs.com/package/@temporal-architect/payload).

## License

MIT
