---
description: Validate .twf files (parse + resolve) and report diagnostics
argument-hint: "[file.twf ...]  (optional; defaults to the .twf files of the current design)"
---

Validate Temporal Workflow Format designs with the `twf_check` MCP tool — the
grammar/semantics gate to run after `.twf` edits.

Target: $ARGUMENTS

1. Call the `twf_check` tool with `paths` set to the target files. If no argument
   was given, first find the relevant `.twf` files (glob the working directory,
   or ask), then check the whole set together — imports mean a single-file check
   can mislead in packaged designs.
2. Report the diagnostics envelope: **errors first**, then warnings, each with
   its `file:line`, diagnostic `code`, and message.
3. If there are zero error-severity diagnostics, say the design clears the
   structural gate — and note that a clean check is a *grammar* gate, not a
   design review (idempotency, races, and cross-file data flow are still review
   concerns).
