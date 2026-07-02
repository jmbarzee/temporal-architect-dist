#!/usr/bin/env node
// stamp-descriptions.mjs — write each channel's short `description` into the
// manifest that gets *embedded in its build artifact*, from docs/descriptions.json
// (the storefront-owned overrides). A value of "@global" inherits the canonical
// vision one-liner from the toolchain's staged global fragment
// (dist-assets/docs/global.md frontmatter).
//
//   node docs/stamp-descriptions.mjs [--assets dist-assets]
//
// Edits are format-preserving (targeted regex on the top-level description),
// so no reformatting churn.
//
// NOT stamped here:
//   - .claude-plugin/marketplace.json — consumed from git by Claude Code, not
//     from a build artifact, so a build-time stamp would have no effect. Its
//     description is committed/hand-maintained (channel-specific).
//   - Homebrew `desc` — publish-brew reads descriptions.json (key "homebrew")
//     and passes it to bump-brew via -desc.
// See documentation_propagation.md.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function globalDescription(assets) {
  const p = join(REPO, assets, "docs", "global.md");
  if (!existsSync(p)) throw new Error(`@global requested but ${p} not staged (run 'make stage-docs')`);
  const m = readFileSync(p, "utf8").match(/^---\n([\s\S]*?)\n---/);
  const d = m && m[1].match(/^description:\s*(.*)$/m);
  if (!d) throw new Error(`no description: in ${p}`);
  return d[1].replace(/^["']|["']$/g, "").trim();
}

// Replace the first top-level `"description": "..."` value, preserving all
// surrounding formatting (indentation, trailing newline, key order).
function stampJson(relPath, value) {
  const p = join(REPO, relPath);
  const text = readFileSync(p, "utf8");
  const re = /^(\s*"description":\s*)"(?:[^"\\]|\\.)*"/m;
  if (!re.test(text)) throw new Error(`no top-level "description" in ${relPath}`);
  writeFileSync(p, text.replace(re, (_, prefix) => prefix + JSON.stringify(value)));
  console.log(`stamped description in ${relPath}`);
}

// Replace the top-level TOML `description = "..."` value.
function stampToml(relPath, value) {
  const p = join(REPO, relPath);
  const text = readFileSync(p, "utf8");
  const re = /^description = "(?:[^"\\]|\\.)*"$/m;
  if (!re.test(text)) throw new Error(`no top-level 'description =' in ${relPath}`);
  const esc = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  writeFileSync(p, text.replace(re, `description = "${esc}"`));
  console.log(`stamped description in ${relPath}`);
}

function main() {
  const assets = arg("--assets", "dist-assets");
  const desc = JSON.parse(readFileSync(join(REPO, "docs/descriptions.json"), "utf8"));
  const resolve = (key) => {
    const v = desc[key];
    if (!v) throw new Error(`descriptions.json missing key: ${key}`);
    return v === "@global" ? globalDescription(assets) : v;
  };

  stampJson("packages/vscode/package.json", resolve("vscode"));
  stampJson("packages/npm/twf/package.json", resolve("npm-twf"));
  stampJson("packages/npm/claude-plugin/package.json", resolve("claude-plugin"));
  stampToml("packages/pypi/twf-cli/pyproject.toml", resolve("pypi"));
}

main();
