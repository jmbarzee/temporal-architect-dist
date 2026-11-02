// @temporal-architect/payload — the single "toolchain interpretation" seam for
// the Node/TypeScript hosts. Given a resolved `twf` binary and a `.twf` file
// set, it runs the CLI and assembles the wire payload the visualizer shell
// renders. The VS Code extension and `@temporal-architect/serve` both consume
// it, so their subprocess glue never drifts.
//
// The Go `twf-view` binary produces the same payload in-process via the
// toolchain pipeline (packages/twf-view/payload.go); that cross-language twin
// is inherent — Go can't import this — but within TypeScript this is the one
// source of truth.

import {
  extractChunks,
  extractGraph,
  parseFiles,
  projectObservedGraph,
  readObservedGraph,
} from "./twf";
import type { BuildOptions, HostMessage, WirePayload } from "./types";

export type {
  Ast,
  BuildOptions,
  DecomposeOptions,
  Diagnostic,
  FileError,
  HostMessage,
  WirePayload,
} from "./types";
export {
  extractChunks,
  extractGraph,
  parseFiles,
  projectObservedGraph,
  readObservedGraph,
};

/**
 * Run the `twf` CLI over the given inputs and assemble the wrapped payload the
 * visualizer consumes: `{ ast, parserGraph?, decomposition? }`.
 *
 * This is the single compute entry point shared by first-paint, the watch loop,
 * and the decomposition-recompute trigger:
 *
 *   - `ast` is always produced (parse is the one required call); its
 *     `diagnostics` are nested inside it, exactly where the shell reads them.
 *   - `parserGraph` is best-effort — `undefined` degrades the graph view to
 *     empty rather than failing the whole payload.
 *   - `decomposition` is computed only when `opts.decompose` is set; otherwise
 *     the payload is graph-only (the trigger-driven first-paint state).
 *
 * Throws only when there are no input files (see {@link parseFiles}); the caller
 * maps that to a `type:"error"` host message.
 */
export async function buildPayload(opts: BuildOptions): Promise<WirePayload> {
  const { twfBin, files, decompose, focusedFile } = opts;

  const ast = await parseFiles(twfBin, files, focusedFile);
  const parserGraph = await extractGraph(twfBin, files);
  const decomposition = decompose
    ? await extractChunks(twfBin, files, decompose)
    : undefined;

  const payload: WirePayload = { ast };
  if (parserGraph !== undefined) payload.parserGraph = parserGraph;
  if (decomposition !== undefined) payload.decomposition = decomposition;
  return payload;
}

/**
 * Build a payload and wrap it as a {@link HostMessage} — a `type:"ast"` message
 * on success (even one carrying parse/graph diagnostics), or a `type:"error"`
 * message a shell surfaces verbatim on a catastrophic build failure (no inputs,
 * unresolvable binary). Convenience for transport hosts (SSE, postMessage) that
 * push HostMessages straight to the shell.
 */
export async function buildMessage(opts: BuildOptions): Promise<HostMessage> {
  try {
    const data = await buildPayload(opts);
    return { type: "ast", data };
  } catch (err) {
    return { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
