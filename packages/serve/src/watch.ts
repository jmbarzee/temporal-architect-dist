// Watch the input set and invoke onChange whenever a `.twf` file under it is
// added, changed, or removed.
//
// chokidar gives us add/unlink natively — better than the Go twf-view's mtime
// polling: a newly created or deleted `.twf` file inside a watched directory
// triggers a rebuild, not just edits to already-known files. We still filter to
// `.twf` (a design tree may hold other files) and re-expand the input set inside
// onChange (in the server), so the watch and the build always agree on the set.
//
// Events are debounced: an editor "save" can fire several rapid change/add
// events (atomic rename, temp files), and a rebuild subprocesses `twf` several
// times, so coalescing keeps one save to one rebuild.

import chokidar, { type FSWatcher } from "chokidar";

const DEBOUNCE_MS = 100;

/**
 * Start watching `paths` (files or directories). Returns a function that stops
 * the watcher. `onChange` is called (debounced) on every relevant `.twf`
 * change; it is not awaited — a rebuild that outlives the next event is
 * superseded by it, and every frame is a full snapshot.
 */
export function watch(paths: string[], onChange: () => void): () => Promise<void> {
  const watcher: FSWatcher = chokidar.watch(paths, {
    ignoreInitial: true, // startup does the first build itself
    ignored: (p: string) => /(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(p),
  });

  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };

  const onPath = (p: string) => {
    if (p.endsWith(".twf")) schedule();
  };
  watcher.on("add", onPath).on("change", onPath).on("unlink", onPath);

  return async () => {
    if (timer) clearTimeout(timer);
    await watcher.close();
  };
}
