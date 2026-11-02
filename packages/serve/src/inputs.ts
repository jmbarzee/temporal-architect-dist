// Expand the CLI's input paths (files and/or directories) into a concrete,
// sorted, deduped set of `.twf` files.
//
// This is the Node twin of the toolchain pipeline's ExpandInputs that the Go
// twf-view relies on: a directory argument means "every .twf under it", and the
// set is re-expanded on every watch event so a newly created or deleted file is
// picked up, not just edits to already-known files. Order-independent (sorted)
// so a nondeterministic readdir order never reads as a change.

import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Recursively collect every `.twf` file under `dir`. */
async function walkTwf(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable/removed directory — contributes nothing this pass
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTwf(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".twf")) {
      out.push(full);
    }
  }
}

/**
 * Resolve `paths` (files or directories) to the sorted, deduped set of absolute
 * `.twf` files. A file argument is included whether or not it ends in `.twf`
 * (an explicit file is an explicit choice); a directory is scanned recursively
 * for `.twf` files only.
 */
export async function expandInputs(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue; // a path that doesn't exist (yet) contributes nothing
    }
    if (stat.isDirectory()) {
      await walkTwf(abs, found);
    } else {
      found.push(abs);
    }
  }
  return Array.from(new Set(found)).sort();
}
