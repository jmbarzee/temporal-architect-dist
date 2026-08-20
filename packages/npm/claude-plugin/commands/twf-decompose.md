---
description: Decompose a .twf design into independently-implementable work chunks
argument-hint: "[file.twf ...]  (optional; defaults to the .twf files of the current design)"
---

Decompose a Temporal Workflow Format design into independently-implementable
chunks of work with the `twf_graph_chunks` MCP tool — a topology-based partition
over the deployment graph, with per-chunk complexity and the inter-chunk
contract-dependency DAG.

Target: $ARGUMENTS

1. Call the `twf_graph_chunks` tool with `paths` set to the target files (if none
   given, find the design's `.twf` files first, then pass the whole set).
2. Present the chunks: each chunk's scope and complexity, and the dependency DAG
   between them (which contracts one chunk owes another).
3. Recommend an implementation order — **contract producers before consumers** —
   derived from the DAG. Note the partition is advisory: confirm boundaries with
   the user before acting on them.
