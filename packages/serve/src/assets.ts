// Locate and load the single-file visualizer bundle served at "/".
//
// The bundle is the shared web-ui entry (packages/web-ui): one self-contained
// HTML document with the JS/CSS inlined. It is copied into this package's
// assets/ at build/prepack time (npm run copy-ui / prepack), so at runtime it
// sits next to the compiled output. dist/assets.js → __dirname is dist/, so the
// bundle is one level up. This mirrors the Go twf-view's go:embed of the same
// file, minus the compile-time embed — Node reads it from disk once at startup.

import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Read the bundled `assets/index.html`. Throws a clear, actionable error if it
 * is missing — that only happens in a broken checkout where the web-ui bundle
 * was never built/copied (a published package always ships it).
 */
export function loadIndexHtml(): string {
  const p = path.join(__dirname, "..", "assets", "index.html");
  try {
    return readFileSync(p, "utf8");
  } catch {
    throw new Error(
      `visualizer bundle not found at ${p}. ` +
        `In a source checkout, build it first: \`npm run build\` in packages/serve ` +
        `(which builds packages/web-ui and copies its bundle here).`,
    );
  }
}
