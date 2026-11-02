# @temporal-architect/payload

Host-agnostic **toolchain interpretation** for the Temporal Architect visualizer.

Given a resolved `twf` binary and a set of `.twf` files, this package runs the
CLI (`twf parse`, `twf graph`, `twf graph chunks`) and assembles the wrapped
payload the visualizer shell (`<VisualizerHost>` in
[`@temporal-architect/visualizer`](https://www.npmjs.com/package/@temporal-architect/visualizer))
renders:

```ts
import { buildPayload } from "@temporal-architect/payload";

const payload = await buildPayload({
  twfBin: "/usr/local/bin/twf",
  files: ["orders/orders.twf", "orders/shipping.twf"],
  // decompose: { ceiling: 60 },   // omit for a graph-only payload
});
// → { ast: { definitions, diagnostics, ... }, parserGraph?, decomposition? }
```

## Why it exists

Two Node hosts subprocess the `twf` CLI to feed the visualizer: the **VS Code
extension** (over the webview `postMessage` seam) and
[`@temporal-architect/serve`](https://www.npmjs.com/package/@temporal-architect/serve)
(over an SSE seam). Rather than each hand-rolling the parse/graph/chunks calls
and the payload assembly — and drifting — they share this one module.

It is deliberately narrow: **no transport, no watch, no host config.** Binary
resolution, option sourcing (settings vs. flags vs. the `/decompose` trigger),
and the browser transport all stay in the host. The Go `twf-view` binary
produces the same payload in-process via the toolchain pipeline; that
cross-language twin is inherent (Go can't import this), but within TypeScript
this is the single source of truth.

## API

| Export | Purpose |
| --- | --- |
| `buildPayload(opts)` | Parse → graph → (optional) chunks → `{ ast, parserGraph?, decomposition? }`. |
| `buildMessage(opts)` | `buildPayload` wrapped as a `HostMessage` (`type:"ast"` \| `type:"error"`). |
| `parseFiles(twfBin, files, focusedFile?)` | `twf parse` per file, merged AST with `sourceFile` stamped and diagnostics nested. |
| `extractGraph(twfBin, files)` | `twf graph --json` → `parserGraph` (best-effort). |
| `extractChunks(twfBin, files, opts)` | `twf graph chunks --json` → `decomposition` (best-effort). |
| `projectObservedGraph(json)` / `readObservedGraph(file)` | Project sampler `observed-graph.json` to a `parserGraph` (history mode). |

## License

MIT
