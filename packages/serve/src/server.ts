// The HTTP surface + served payload state. Single host behind every route:
// first paint, the SSE stream, the /graph.json parity endpoint, and the
// decomposition-recompute trigger all read or drive the same build path, so the
// browser and a scripted `curl` never see divergent graphs.
//
// This is the Node re-implementation of the Go twf-view server (server.go +
// hub.go): same routes, same wire contract, same trigger-driven decomposition
// policy — the difference is only the substrate (subprocess `twf` via
// @temporal-architect/payload, instead of the in-process toolchain pipeline).

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server as HttpServer } from "node:http";

import {
  buildMessage,
  buildPayload,
  type DecomposeOptions,
} from "@temporal-architect/payload";

import { loadIndexHtml } from "./assets";
import { Hub, writeFrame } from "./hub";
import { expandInputs } from "./inputs";

// Strict, localhost-appropriate CSP — a byte-for-byte match of the Go twf-view
// server's. It permits only the inlined single-file bundle (unsafe-inline
// script/style, since vite-plugin-singlefile inlines both) and same-origin
// connections (the SSE stream + the /decompose POST). No auth: the listener is
// bound to 127.0.0.1 and the tool is single-user by design.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const HEARTBEAT_MS = 25_000;

/** JSON body of POST /decompose — the DecompositionParams the Groups panel
 * sends. All fields optional; an unset field takes the tool's own default. */
interface DecompositionParams {
  ceiling?: number;
  floor?: number;
  by?: string[];
  maxDepth?: number;
}

export class Server {
  private readonly hub = new Hub();
  private readonly indexHtml: string;

  // Decomposition mode. Graph-only is the default (matching the pipeline's
  // documented "serve uses Build" stance and the Go twf-view); the first POST
  // /decompose flips it on and records opts, and every rebuild thereafter
  // carries the overlay so it tracks .twf edits. The visualizer's Groups panel
  // is built for exactly this "no decomposition yet → request the first one"
  // flow, so a graph-only first paint is the intended state, not a degraded one.
  private decompose: DecomposeOptions | undefined;

  constructor(
    private readonly twfBin: string,
    private readonly paths: string[],
  ) {
    this.indexHtml = loadIndexHtml();
  }

  /** Recompute the payload from the current inputs + mode and publish it to
   * every connected client. Idempotent; safe to call from the watch loop, the
   * decomposition trigger, and startup. */
  async rebuild(): Promise<void> {
    const files = await expandInputs(this.paths);
    const msg = await buildMessage({
      twfBin: this.twfBin,
      files,
      decompose: this.decompose,
    });
    this.hub.publish(JSON.stringify(msg));
  }

  /** The bound onRequest handler. */
  private handle = (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");

    const url = (req.url ?? "/").split("?")[0];
    if (url === "/events") return void this.handleEvents(req, res);
    if (url === "/graph.json") return void this.handleGraphJson(res);
    if (url === "/decompose") return void this.handleDecompose(req, res);
    if (url === "/") return this.handleIndex(res);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  };

  private handleIndex(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(this.indexHtml);
  }

  // SSE stream. On connect, immediately writes the current snapshot (first
  // paint), then forwards every published frame until the client disconnects. A
  // periodic comment heartbeat keeps intermediaries from idling the connection
  // shut and lets us notice a dead peer.
  private handleEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const snapshot = this.hub.snapshot();
    if (snapshot !== null) writeFrame(res, snapshot);

    this.hub.subscribe(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      this.hub.unsubscribe(res);
    };
    req.on("close", close);
    res.on("error", close);
  }

  // Scriptable parity / debug endpoint: the current wrapped payload as pretty
  // JSON. Its bytes are the payload the SSE stream pushes (both flow through
  // @temporal-architect/payload), so a `curl` and the browser agree.
  private async handleGraphJson(res: ServerResponse): Promise<void> {
    try {
      const files = await expandInputs(this.paths);
      const payload = await buildPayload({
        twfBin: this.twfBin,
        files,
        decompose: this.decompose,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload, null, 2));
    } catch (err) {
      res.writeHead(422, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(err instanceof Error ? err.message : String(err));
    }
  }

  // UI→toolchain recompute trigger. Accepts the DecompositionParams the Groups
  // panel emits, maps them onto DecomposeOptions, flips the server into
  // decomposition mode, and rebuilds — the fresh overlay flows back out over
  // SSE. Returns 204; the result arrives on the event stream, not this response.
  private handleDecompose(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST", "Content-Type": "text/plain" });
      res.end("method not allowed");
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1 << 16) {
        aborted = true;
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("payload too large");
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      let params: DecompositionParams;
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        params = body ? (JSON.parse(body) as DecompositionParams) : {};
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("invalid decomposition params: " + (err instanceof Error ? err.message : String(err)));
        return;
      }

      this.decompose = toOptions(params);
      res.writeHead(204);
      res.end();
      // Rebuild after responding; the overlay arrives on the SSE stream.
      void this.rebuild();
    });
  }

  /** Build the http.Server (not yet listening). */
  create(): HttpServer {
    return createServer(this.handle);
  }
}

/** Map the wire DecompositionParams onto DecomposeOptions, preserving "unset"
 * so the tool's own defaults win (never forces an explicit 0/[]). */
function toOptions(p: DecompositionParams): DecomposeOptions {
  const o: DecomposeOptions = {};
  if (p.ceiling !== undefined) o.ceiling = p.ceiling;
  if (p.floor !== undefined) o.floor = p.floor;
  if (p.maxDepth !== undefined) o.maxDepth = p.maxDepth;
  if (p.by !== undefined) o.by = p.by;
  return o;
}
