---
description: Show the resolved deployment graph of a .twf design
argument-hint: "[file.twf ...]  (optional; defaults to the .twf files of the current design)"
---

Show the resolved deployment graph of a Temporal Workflow Format design with the
`twf_graph` MCP tool — nodes are runtime deployments, edges are confirmed
dispatches between them.

Target: $ARGUMENTS

1. Call the `twf_graph` tool with `paths` set to the target files (if none given,
   find the design's `.twf` files first, then pass the whole set).
2. Summarize the graph: the deployments (workers / namespaces / task queues) and
   the dispatch edges between them. Call out anything unreachable or unexpected.
3. For an interactive, visual view outside an editor, point the user at
   `twf-view` — the live visualizer host — with a working install line:
   `brew install jmbarzee/twf/twf-view` (or `go install
   github.com/jmbarzee/temporal-architect-dist/packages/twf-view@latest`). Inside
   VS Code / Cursor, the TWF extension's visualizer is the in-editor equivalent.
