// The three `twf` subprocess calls plus the sampler-output projection, factored
// out of the VS Code extension's WorkflowVisualizerPanel so the extension and
// `@temporal-architect/serve` share one implementation instead of two copies
// that drift. Every function here is host-agnostic: it takes an already-resolved
// `twf` binary and an already-resolved file set and speaks only child_process +
// JSON. Binary resolution, option sourcing, and transport stay in the host.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { Ast, DecomposeOptions, Diagnostic, FileError } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Run `twf parse <file>` over each file individually and merge the results into
 * the AST the visualizer renders.
 *
 * Per-file (not one multi-file call) because each definition is stamped with the
 * `sourceFile` it came from — the file-filter partition downstream keys on it.
 * `twf graph`/`twf graph chunks`, by contrast, need the whole set at once (see
 * {@link extractGraph}), so they are single multi-file calls.
 *
 * Structured findings ride in each envelope's `diagnostics`; a diagnostic the
 * producer left without a `file` is stamped with the path we invoked so the
 * shown/hidden partition has a valid key. Catastrophic per-file failures (binary
 * missing, IO error, malformed envelope) are collected as {@link FileError}s
 * rather than thrown, so one unreadable file never blanks the whole tree.
 *
 * Throws only when `files` is empty — there is nothing to parse and the caller
 * should surface that as an error message, not an empty graph.
 */
export async function parseFiles(
  twfBin: string,
  files: string[],
  focusedFile?: string,
): Promise<Ast> {
  if (files.length === 0) {
    throw new Error("no .twf files to parse");
  }

  const definitions: unknown[] = [];
  const diagnostics: Diagnostic[] = [];
  const errors: FileError[] = [];

  for (const file of files) {
    try {
      const { stdout, stderr } = await execFileAsync(twfBin, ["parse", file]);
      // Diagnostics ride in the envelope; a successful `twf parse` is expected
      // to leave stderr empty. Surface any non-empty stderr for debugging but
      // do NOT treat it as a failure — that path used to masquerade structured
      // warnings as parser errors.
      if (stderr) {
        console.warn("twf parse stderr:", stderr);
      }

      const parsed = JSON.parse(stdout) as {
        definitions?: unknown[];
        diagnostics?: Diagnostic[];
      };

      if (parsed.definitions) {
        for (const def of parsed.definitions) {
          (def as { sourceFile?: string }).sourceFile = file;
          definitions.push(def);
        }
      }

      if (parsed.diagnostics) {
        for (const diag of parsed.diagnostics) {
          diagnostics.push({
            ...diag,
            file: diag.file && diag.file.length > 0 ? diag.file : file,
          });
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: string }).stderr;
      errors.push({ file, error, stderr: stderr ? stderr.trim() : undefined });
      console.warn(`failed to parse ${file}:`, err);
    }
  }

  const ast: Ast = { definitions, diagnostics };
  if (errors.length > 0) ast.errors = errors;
  if (focusedFile !== undefined) ast.focusedFile = focusedFile;
  return ast;
}

/**
 * Run `twf graph --json` once over the full file set and return the `graph`
 * payload from the envelope.
 *
 * Single multi-file call: the graph is single-resolution-context (cross-file
 * dispatch must resolve across the same merged AST `twf parse` already merges).
 *
 * Best-effort: returns `undefined` (never throws) when the call fails or no
 * graph was produced, so the graph view degrades to "empty" rather than
 * blocking the tree view. Per-file parse problems surface as diagnostics and
 * still produce a graph; only catastrophic failures land here.
 */
export async function extractGraph(
  twfBin: string,
  files: string[],
): Promise<unknown | undefined> {
  if (files.length === 0) return undefined;
  try {
    const { stdout, stderr } = await execFileAsync(twfBin, [
      "graph",
      "--json",
      ...files,
    ]);
    if (stderr) console.warn("twf graph stderr:", stderr);
    const envelope = JSON.parse(stdout) as { graph?: unknown };
    return envelope.graph;
  } catch (err) {
    console.warn("failed to extract deployment graph:", err);
    return undefined;
  }
}

/**
 * Run `twf graph chunks --json` once over the full file set — the topology-based
 * decomposition that powers the Graph view's group overlay. Same
 * single-resolution-context, multi-file shape as {@link extractGraph}.
 *
 * Only the knobs the caller set are forwarded: an unset field is left to the
 * tool's own default, and passing an explicit 0/[] would override that default.
 * `--by` takes ONE comma-separated value (repeating the flag would silently keep
 * only the last strategy). The resolved analysis parameters ride back inside the
 * payload, so the read-only Params tab needs nothing more here.
 *
 * Best-effort: returns `undefined` (never throws) when the call fails or no
 * chunks were produced, so the overlay degrades to "absent".
 */
export async function extractChunks(
  twfBin: string,
  files: string[],
  opts: DecomposeOptions,
): Promise<unknown | undefined> {
  if (files.length === 0) return undefined;

  const args = ["graph", "chunks", "--json"];
  if (opts.ceiling !== undefined) args.push("--ceiling", String(opts.ceiling));
  if (opts.floor !== undefined && opts.floor > 0) {
    args.push("--floor", String(opts.floor));
  }
  if (opts.maxDepth !== undefined && opts.maxDepth > 0) {
    args.push("--max-depth", String(opts.maxDepth));
  }
  if (opts.by && opts.by.length > 0) args.push("--by", opts.by.join(","));
  args.push(...files);

  try {
    const { stdout, stderr } = await execFileAsync(twfBin, args);
    if (stderr) console.warn("twf graph chunks stderr:", stderr);
    const envelope = JSON.parse(stdout) as { chunks?: unknown };
    return envelope.chunks;
  } catch (err) {
    console.warn("failed to extract decomposition:", err);
    return undefined;
  }
}

/**
 * Project the sampler's observed-graph JSON (`{ observedGraph: { window, …,
 * edges: [{ …, buckets }] } }`) to the `parserGraph` the Graph view consumes.
 *
 * The observed graph is a superset of a parserGraph: it adds a `window` and a
 * per-edge `buckets` occurrence series. We drop `window` and keep the rest — the
 * extra `buckets` field is inert for rendering. Projecting here (rather than
 * shipping the raw envelope) keeps hosts decoupled from the visualizer's
 * payload-normalization version.
 *
 * Best-effort: a missing `observedGraph` key returns `undefined`; a malformed
 * JSON string throws (the caller reads the file, so it owns IO errors).
 */
export function projectObservedGraph(json: string): unknown | undefined {
  const parsed = JSON.parse(json) as { observedGraph?: Record<string, unknown> };
  const og = parsed.observedGraph;
  if (!og) return undefined;
  const { window: _window, ...parserGraph } = og;
  return parserGraph;
}

/**
 * Read and project the sampler's observed-graph JSON at `file`. Convenience
 * wrapper over {@link projectObservedGraph} that owns the file read; returns
 * `undefined` (never throws) on a missing/malformed file so a history-mode host
 * degrades to an empty graph.
 */
export async function readObservedGraph(
  file: string,
): Promise<unknown | undefined> {
  try {
    return projectObservedGraph(await readFile(file, "utf8"));
  } catch (err) {
    console.warn("failed to read observed graph:", err);
    return undefined;
  }
}
