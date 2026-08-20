#!/usr/bin/env bash
#
# PostToolUse hook: after a Write/Edit to a `.twf` file, run `twf check` over the
# edited file's directory and surface any error-severity diagnostics back to the
# agent — non-blocking. This makes validation structural (the toolchain reports)
# instead of relying on the agent to remember to check after every edit.
#
# Design notes:
#   * Non-blocking: always exits 0. Feedback reaches the model via the documented
#     PostToolUse JSON `hookSpecificOutput.additionalContext` field. This
#     deliberately preserves the `twf check --lenient` WIP-iteration flow — the
#     hook informs, it never obstructs.
#   * Whole-package: checks every `*.twf` in the edited file's directory, not just
#     the one file, so imports resolve. A single-file check misleads in packaged
#     designs (see the design skill's reverse-engineering reference).
#   * twf delivery: an installed plugin has no `twf` on PATH, so we invoke it via
#     `npx @temporal-architect/twf@<version>` — the same wrapper as the plugin's
#     MCP server. The version is read from this plugin's own package.json so the
#     hook's twf and the plugin's skills/MCP always move in lockstep.
#
# Dependencies: node (guaranteed — npx and the plugin runtime require it).

set -euo pipefail

payload="$(cat)"

# The path of the file just written/edited (Write/Edit → tool_input.file_path;
# fall back to tool_input.path for safety).
file="$(
  printf '%s' "$payload" | node -e '
    let s = "";
    process.stdin.on("data", d => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s);
        const ti = j.tool_input || {};
        process.stdout.write(ti.file_path || ti.path || "");
      } catch { process.stdout.write(""); }
    });'
)"

# Only act on .twf edits; ignore everything else silently.
case "$file" in
  *.twf) ;;
  *) exit 0 ;;
esac

dir="$(dirname "$file")"

# The twf version this plugin ships (lockstep with skills + MCP server).
ver="$(
  node -e '
    try { process.stdout.write(require(process.env.CLAUDE_PLUGIN_ROOT + "/package.json").version || "latest"); }
    catch { process.stdout.write("latest"); }'
)"

# Run the grammar/semantics gate over the whole package. Capture output + exit
# code without tripping `set -e`.
set +e
output="$(cd "$dir" && npx -y "@temporal-architect/twf@${ver}" check ./*.twf 2>&1)"
code=$?
set -e

# Clean (no error-severity diagnostics) → stay silent. Otherwise surface the
# diagnostics to the agent as non-blocking context.
if [ "$code" -eq 0 ]; then
  exit 0
fi

node -e '
  const out = process.argv[1];
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "`twf check` found error-severity diagnostics after your .twf edit " +
        "(whole-package check). Fix these before presenting the design:\n\n" + out
    }
  }));
' "$output"

exit 0
