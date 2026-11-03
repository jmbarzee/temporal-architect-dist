#!/usr/bin/env node
// twf-serve — host the Temporal Architect visualizer over a local HTTP server.
//
// It expands a set of `.twf` inputs, subprocesses the `twf` CLI to build the
// graph payload (via @temporal-architect/payload), serves the shared web-ui
// bundle at a loopback URL, watches the files, and pushes re-parsed graphs to
// the browser over SSE on every change. The Node/npx sibling of the Go twf-view
// binary — same wire contract, same browser entry, different substrate.
//
// Usage: twf-serve [--port N] [--open] [--twf <path>] <file-or-dir...>
//
// Binds 127.0.0.1 only, runs in the foreground, stops on Ctrl+C.

import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";

import { resolveTwf } from "./twfbin";
import { Server } from "./server";
import { watch } from "./watch";

interface Args {
  port: number;
  open: boolean;
  twf?: string;
  paths: string[];
}

const USAGE =
  "usage: twf-serve [--port N] [--open] [--twf <path>] <file-or-dir...>\n\n" +
  "Serve the Temporal Architect visualizer over local HTTP, live-reloading as\n" +
  "the given .twf files (or every .twf under the given directories) change.\n" +
  "Binds 127.0.0.1 only; Ctrl+C to stop.\n\n" +
  "  --port N     port to bind on 127.0.0.1 (default: OS-assigned)\n" +
  "  --open       open the served URL in the default browser\n" +
  "  --twf <path> path to the twf binary (default: bundled @temporal-architect/twf, else PATH)\n" +
  "  --version    print version and exit\n";

function parseArgs(argv: string[]): Args | { version: true } | { help: true } {
  const args: Args = { port: 0, open: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--version":
      case "-v":
        return { version: true };
      case "--help":
      case "-h":
        return { help: true };
      case "--open":
        args.open = true;
        break;
      case "--port":
        args.port = parseInt(argv[++i] ?? "", 10);
        if (!Number.isInteger(args.port) || args.port < 0) {
          throw new Error(`invalid --port: ${argv[i]}`);
        }
        break;
      case "--twf":
        args.twf = argv[++i];
        if (!args.twf) throw new Error("--twf requires a path");
        break;
      default:
        if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
        args.paths.push(a);
    }
  }
  return args;
}

/** Best-effort open `url` in the platform default browser. Non-fatal: the URL
 * is already printed, so the user can open it by hand. */
function openBrowser(url: string): void {
  const [cmd, cmdArgs] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd as string, cmdArgs as string[], { stdio: "ignore", detached: true }).unref();
  } catch (err) {
    process.stderr.write(`twf-serve: could not open browser (${String(err)}); open ${url} manually\n`);
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if ("version" in parsed) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    process.stdout.write(`twf-serve ${require("../package.json").version}\n`);
    return;
  }
  if ("help" in parsed) {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed.paths.length === 0) {
    process.stderr.write(USAGE);
    throw new Error("no input files");
  }

  const { bin, source } = resolveTwf(parsed.twf);
  const server = new Server(bin, parsed.paths);
  const httpServer = server.create();

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(parsed.port, "127.0.0.1", resolve);
  });

  const addr = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/`;

  // Seed the first snapshot before anyone connects, so /events + /graph.json
  // have a payload immediately.
  await server.rebuild();

  const stopWatch = watch(parsed.paths, () => {
    void server.rebuild();
  });

  process.stdout.write(
    `twf-serve: watching ${parsed.paths.length} input(s), serving ${url}\n` +
      `twf-serve: twf resolved from ${source}\n` +
      `twf-serve: press Ctrl+C to stop\n`,
  );
  if (parsed.open) openBrowser(url);

  const shutdown = () => {
    process.stdout.write("\ntwf-serve: stopping\n");
    void stopWatch().finally(() => {
      httpServer.close(() => process.exit(0));
      // Force-exit if lingering SSE sockets keep the server open past a grace.
      setTimeout(() => process.exit(0), 1000).unref();
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`twf-serve: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
