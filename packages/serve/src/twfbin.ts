// Resolve the `twf` binary this server drives.
//
// Priority: an explicit `--twf <path>` (handled by the caller) > the
// platform-specific `@temporal-architect/twf-<platform>` package this package
// depends on (via @temporal-architect/twf's optionalDependencies) > a plain
// `twf` on PATH.
//
// We resolve the platform binary DIRECTLY rather than spawning the
// `@temporal-architect/twf` `bin/twf.js` wrapper: this server calls `twf` many
// times per change (once per file to parse, plus graph + chunks), and going
// through the Node wrapper would fork an extra `node` process each time. Same
// PLATFORM_PACKAGES map as the wrapper (biome/esbuild/turbo pattern); npm's
// `os`/`cpu` resolution installs only the matching optional dependency.

const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@temporal-architect/twf-darwin-arm64",
  "darwin-x64": "@temporal-architect/twf-darwin-x64",
  "linux-x64": "@temporal-architect/twf-linux-x64",
  "linux-arm64": "@temporal-architect/twf-linux-arm64",
  "win32-x64": "@temporal-architect/twf-win32-x64",
};

/**
 * Resolve the `twf` executable. Returns the resolved path/command and how it was
 * found (for a friendly startup log). Never throws: an unresolved platform
 * package falls back to `"twf"` on PATH, which either works or fails later with
 * a clear per-call parse error the payload surfaces.
 */
export function resolveTwf(override?: string): { bin: string; source: string } {
  if (override) return { bin: override, source: "--twf" };

  const key = `${process.platform}-${process.arch}`;
  const pkg = PLATFORM_PACKAGES[key];
  if (pkg) {
    const ext = process.platform === "win32" ? ".exe" : "";
    try {
      return { bin: require.resolve(`${pkg}/bin/twf${ext}`), source: pkg };
    } catch {
      // The optional dependency was skipped (e.g. --no-optional) or the platform
      // is unsupported; fall through to PATH.
    }
  }
  return { bin: "twf", source: "PATH" };
}
