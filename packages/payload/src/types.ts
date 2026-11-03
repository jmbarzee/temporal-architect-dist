// Public types for @temporal-architect/payload.
//
// These describe the wire payload the visualizer shell (`<VisualizerHost>` /
// normalizePayload in @temporal-architect/visualizer) consumes. They are
// intentionally structural / duck-typed at the JSON boundary — the parser's
// AST and graph shapes are owned by the toolchain, so this package treats their
// interiors as opaque `unknown` and only pins down the envelope it assembles.

/**
 * A structured validator/resolver/parse diagnostic as emitted inside the JSON
 * envelope of `twf parse`. Mirrors the `Diagnostic` DTO in
 * `@temporal-architect/wire-types`; kept as a local structural type so this
 * package stays dependency-free (a published leaf shouldn't drag a types
 * package into every consumer's `.d.ts`). Only the fields this package touches
 * are named; anything else the producer emits rides through untouched.
 */
export interface Diagnostic {
  /** Absolute path of the file the diagnostic refers to. */
  file?: string;
  [key: string]: unknown;
}

/**
 * A catastrophic per-file parser-process failure — the binary missing, an IO
 * error, or a malformed envelope. Distinct from a {@link Diagnostic}: a
 * FileError means `twf parse` never produced usable output for that file, while
 * a Diagnostic is a finding from a *successful* run.
 */
export interface FileError {
  file: string;
  error: string;
  stderr?: string;
}

/**
 * The `ast` half of the wire payload — the merged parse result across the whole
 * file set, with diagnostics nested *inside* it (the shell drops any sibling
 * `diagnostics` key and reads `ast.diagnostics`). `diagnostics` is always an
 * array so the shell's `ast.diagnostics || []` and downstream consumers see a
 * stable type even when empty.
 */
export interface Ast {
  definitions: unknown[];
  diagnostics: Diagnostic[];
  /** Present only when catastrophic per-file failures occurred. */
  errors?: FileError[];
  /** Host-specific: the file the UI should focus at top level (VS Code only). */
  focusedFile?: string;
}

/**
 * The wrapped payload the visualizer's `normalizePayload` consumes:
 * `{ ast, parserGraph?, decomposition? }`. `parserGraph` and `decomposition`
 * are opaque here — they flow straight from `twf graph`/`twf graph chunks`.
 */
export interface WirePayload {
  ast: Ast;
  parserGraph?: unknown;
  decomposition?: unknown;
}

/**
 * The `HostMessage` union the visualizer shell consumes, mirroring the
 * TypeScript union in `@temporal-architect/visualizer`'s protocol module:
 *
 *   { type: 'ast';   data: WirePayload }
 *   { type: 'error'; message: string }
 */
export type HostMessage =
  | { type: "ast"; data: WirePayload }
  | { type: "error"; message: string };

/**
 * Decomposition knobs, mirroring the `DecompositionParams` the visualizer's
 * Groups panel emits and the `--ceiling`/`--floor`/`--max-depth`/`--by` flags
 * of `twf graph chunks`. All optional; an unset field is left to the tool's own
 * default (we never pass an explicit 0/[] that would override it).
 */
export interface DecomposeOptions {
  ceiling?: number;
  floor?: number;
  maxDepth?: number;
  by?: string[];
}

/** Input to {@link buildPayload}. */
export interface BuildOptions {
  /**
   * The resolved `twf` executable — a single binary path or a command on PATH.
   * Host-specific resolution (VS Code settings > bundled binary > PATH; or the
   * `@temporal-architect/twf` platform binary > PATH) lives in the caller.
   */
  twfBin: string;
  /** The resolved `.twf` file set (already expanded/deduped by the caller). */
  files: string[];
  /**
   * When present, the chunk-decomposition overlay is computed and included.
   * When absent, the payload is graph-only — the trigger-driven first-paint
   * state the twf-view/serve hosts use (matching the pipeline's "serve uses
   * Build" stance). The VS Code host passes this on every refresh (always-on
   * overlay); the SSE hosts pass it only after a `/decompose` trigger.
   */
  decompose?: DecomposeOptions;
  /** Host-specific: focused file to stamp into the AST (VS Code only). */
  focusedFile?: string;
}
