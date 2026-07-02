#!/usr/bin/env node
// render.mjs — compose each channel's README from the toolchain's canonical doc
// fragments + a per-target header template.
//
//   node docs/render.mjs --version <X.Y.Z> [--assets dist-assets] [--target <name>]
//
// Fragments are plain markdown that ship *inside* the artifacts they cover; the
// Makefile `stage-docs` step extracts them into <assets>/docs/ (global.md,
// parser.md, mcp.md, visualizer.md) and the skills into <assets>/docs/skills/.
// This script reads those files directly — there is no runtime `twf` call.
//
// Each template embeds tokens the renderer substitutes:
//   {{fragment:global}} {{fragment:parser}} {{fragment:mcp}} {{fragment:visualizer}}
//   {{skills}}
// Relative image refs (images/x.png) are rewritten to release-pinned absolute
// URLs so every registry renders the picture that matches the published tag.
//
// Rendered READMEs are generated build output (gitignored). Never hand-edit
// them — edit the toolchain fragment or the per-target template in docs/templates/.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_REPO = "jmbarzee/temporal-architect";

// target -> { template (in docs/templates), output README path } (repo-relative)
const TARGETS = {
  vscode: { template: "vscode.md", out: "packages/vscode/README.md" },
  "npm-twf": { template: "npm-twf.md", out: "packages/npm/twf/README.md" },
  pypi: { template: "pypi.md", out: "packages/pypi/twf-cli/README.md" },
  "claude-plugin": { template: "claude-plugin.md", out: "packages/npm/claude-plugin/README.md" },
};

function parseArgs(argv) {
  const args = { assets: "dist-assets", target: null, version: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version") args.version = argv[++i];
    else if (a === "--assets") args.assets = argv[++i];
    else if (a === "--target") args.target = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.version) throw new Error("required: --version <X.Y.Z>");
  args.version = args.version.replace(/^v/, "");
  return args;
}

// Split "---\n<yaml>\n---\n<body>" into { meta, body }. Only `description:` is read.
function parseFragment(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: m[2].trim() };
}

function loadFragments(docsDir) {
  const frags = {};
  for (const name of ["global", "parser", "mcp", "visualizer"]) {
    const p = join(docsDir, `${name}.md`);
    if (!existsSync(p)) throw new Error(`missing staged fragment: ${p} (run 'make stage-docs')`);
    frags[name] = parseFragment(readFileSync(p, "utf8"));
  }
  return frags;
}

// Compose the skills bullet list from staged SKILL.md frontmatter. The trigger
// clause ("Use when …") is dropped so the listing reads as a pitch.
function renderSkills(skillsDir) {
  if (!existsSync(skillsDir)) throw new Error(`missing staged skills: ${skillsDir} (run 'make stage-docs')`);
  const rows = [];
  for (const entry of readdirSync(skillsDir).sort()) {
    const skillMd = join(skillsDir, entry, "SKILL.md");
    if (!existsSync(skillMd) || !statSync(join(skillsDir, entry)).isDirectory()) continue;
    const { meta } = parseFragment(readFileSync(skillMd, "utf8"));
    if (!meta.name || !meta.description) continue;
    const pitch = meta.description.split(/\.\s+Use\b/)[0].replace(/\.*$/, "");
    rows.push(`- **${meta.name}** — ${pitch}.`);
  }
  if (!rows.length) throw new Error(`no SKILL.md frontmatter found under ${skillsDir}`);
  return rows.join("\n");
}

function render(templateText, frags, skills, imageBase) {
  let out = templateText;
  out = out.replace(/\{\{fragment:(\w+)\}\}/g, (_, name) => {
    if (!frags[name]) throw new Error(`template references unknown fragment: ${name}`);
    return frags[name].body;
  });
  out = out.replace(/\{\{skills\}\}/g, () => skills);
  if (/\{\{[^}]+\}\}/.test(out)) throw new Error(`unresolved token remains: ${out.match(/\{\{[^}]+\}\}/)[0]}`);
  // Rewrite relative image refs to release-pinned absolute URLs.
  out = out.replace(/\]\(\.?\/?images\//g, `](${imageBase}`);
  out = out.replace(/src="\.?\/?images\//g, `src="${imageBase}`);
  return out.replace(/\s*$/, "\n");
}

function main() {
  const { assets, target, version } = parseArgs(process.argv.slice(2));
  const docsDir = join(REPO, assets, "docs");
  const imageBase = `https://raw.githubusercontent.com/${IMAGE_REPO}/v${version}/docs/images/`;

  const frags = loadFragments(docsDir);
  const skills = renderSkills(join(docsDir, "skills"));

  const names = target ? [target] : Object.keys(TARGETS);
  for (const name of names) {
    const t = TARGETS[name];
    if (!t) throw new Error(`unknown target: ${name} (known: ${Object.keys(TARGETS).join(", ")})`);
    const tmpl = readFileSync(join(REPO, "docs/templates", t.template), "utf8");
    const readme = render(tmpl, frags, skills, imageBase);
    writeFileSync(join(REPO, t.out), readme);
    console.log(`rendered ${t.out}`);
  }
}

main();
