// SSE fan-out. Holds the current payload frame (so a client connecting
// mid-session gets an immediate first paint) and the set of connected response
// streams (so a change reaches every open browser tab).
//
// Single-user localhost means the client count is tiny; a plain Set of writers
// is more than enough. Each frame is a full snapshot, so a client that missed
// an intermediate frame still converges on current — there is nothing durable
// to lose. Node's ServerResponse buffers writes internally, so unlike the Go
// hub's per-client buffered channel there is no explicit "reader is behind, drop
// this frame" path: a slow socket simply backs up in its own kernel/stream
// buffer and drains, and the next full snapshot supersedes anything queued.

import type { ServerResponse } from "node:http";

export class Hub {
  private current: string | null = null;
  private readonly clients = new Set<ServerResponse>();

  /** Record `frame` as the current snapshot and push it to every client. */
  publish(frame: string): void {
    this.current = frame;
    for (const res of this.clients) {
      writeFrame(res, frame);
    }
  }

  /** The current snapshot, or null before the first build. */
  snapshot(): string | null {
    return this.current;
  }

  /** Register a client stream; it will receive every subsequent frame. */
  subscribe(res: ServerResponse): void {
    this.clients.add(res);
  }

  /** Deregister a client stream (on disconnect). */
  unsubscribe(res: ServerResponse): void {
    this.clients.delete(res);
  }
}

/** Write one SSE `data:` frame. HostMessage JSON is single-line, so one
 * `data:` line is always sufficient. */
export function writeFrame(res: ServerResponse, frame: string): void {
  res.write(`data: ${frame}\n\n`);
}
