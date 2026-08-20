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
3. For an interactive, visual view, point the user at the TWF visualizer
   extension.
